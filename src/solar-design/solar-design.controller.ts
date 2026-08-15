import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import type { Response } from 'express';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { PermissionsService } from '../permissions/permissions.service';
import type { PermissionKey } from '../permissions/permission-catalog';
import { JobsService, type JobListViewer } from '../jobs/jobs.service';
import {
  RenderRoofDesignDto,
  RoofDesignDocDto,
  SimulateRoofDesignDto,
} from './dto/roof-design.dto';
import { RoofDesignService } from './roof-design.service';
import { RoofDesignRenderService } from './roof-design-render.service';
import { SolarSimulationService } from './solar-simulation.service';
import {
  SolarImageryService,
  latLonToTile,
  metresPerPixelAt,
} from './solar-imagery.service';
import { SolarTileProxyService } from './solar-tile-proxy.service';
import { SolarTileTokenService } from './solar-tile-token.service';
import { SolarTileTokenGuard } from './guards/solar-tile-token.guard';
import { TestImageryProviderDto } from './dto/test-imagery-provider.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

@ApiTags('Solar Design Studio')
@ApiBearerAuth('JWT')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `Authorization: Bearer` JWT.',
})
@Controller()
export class SolarDesignController {
  constructor(
    private readonly roofDesigns: RoofDesignService,
    private readonly render: RoofDesignRenderService,
    private readonly simulation: SolarSimulationService,
    private readonly imagery: SolarImageryService,
    private readonly tileProxy: SolarTileProxyService,
    private readonly tileTokens: SolarTileTokenService,
    private readonly permissions: PermissionsService,
    private readonly jobsService: JobsService,
  ) {}

  /** Authorizes the permission and resolves the manager/installer scope, then confirms the job is in-scope (404 otherwise). */
  private async authorizeJobAction(
    req: AuthRequest,
    jobId: string,
    permission: PermissionKey,
  ): Promise<JobListViewer> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    const effective = await this.permissions.getEffectiveForUser(userId);
    this.permissions.assertPermission(effective, permission);
    const viewer: JobListViewer = {
      userId,
      role,
      jobScope: effective.scopes.job === 'all' ? 'all' : 'own',
    };

    // Reuses JobsService's own scope logic (manager/installer 404 on
    // out-of-scope jobs) rather than duplicating it here.
    await this.jobsService.getOne(jobId, viewer);
    return viewer;
  }

  @Get('jobs/:jobId/roof-design')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Get the live roof design for a job',
    description: 'Returns `null` data when no design has been saved yet.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  @ApiOkResponse({ description: '`{ data: RoofDesignRecord | null }`' })
  async getOne(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: AuthRequest,
  ) {
    await this.authorizeJobAction(req, jobId, 'job:view');
    return await this.roofDesigns.getForJob(jobId);
  }

  @Put('jobs/:jobId/roof-design')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Full-document upsert of the roof design',
    description:
      'Validates the full `RoofDesignDoc`: max 4 arrays, simple non-self-intersecting polygons, panels inside the setback-inset roof plane with no panel/panel or panel/obstruction overlap, and every `panelModelId` resolving to a non-discontinued panel.',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  async upsert(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: RoofDesignDocDto,
    @Req() req: AuthRequest,
  ) {
    const viewer = await this.authorizeJobAction(
      req,
      jobId,
      'job:proposal:update',
    );
    return await this.roofDesigns.upsert(jobId, dto, viewer.userId);
  }

  @Post('jobs/:jobId/roof-design/simulate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Stateless live-feedback simulation',
    description:
      'Body is a `RoofDesignDoc` plus optional tariff overrides; nothing is written. Returns per-array tilted-plane production, financials and design warnings (§4 of the spec).',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  async simulate(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: SimulateRoofDesignDto,
    @Req() req: AuthRequest,
  ) {
    await this.authorizeJobAction(req, jobId, 'job:view');
    return await this.simulation.simulate(dto, jobId);
  }

  @Post('jobs/:jobId/roof-design/render')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  // The `pngBase64`-less fallback path turns one request into a full grid of
  // outbound tile fetches against the upstream imagery provider — give it
  // its own tighter bucket rather than the app's default CRUD-sized one.
  @SkipThrottle({ default: true })
  @Throttle({ 'solar-imagery-outbound': {} })
  @ApiOperation({
    summary: 'Store the canvas render as a job file',
    description:
      'Persists `pngBase64` as a `roof_design_render` file for the proposal PDF and links it onto the saved roof design (which must already exist).',
  })
  @ApiParam({ name: 'jobId', description: 'Job UUID' })
  async storeRender(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: RenderRoofDesignDto,
    @Req() req: AuthRequest,
  ) {
    const viewer = await this.authorizeJobAction(
      req,
      jobId,
      'job:proposal:update',
    );
    return await this.render.storeRender(
      jobId,
      {
        pngBase64: dto.pngBase64,
        widthPx: dto.widthPx,
        heightPx: dto.heightPx,
      },
      viewer.userId,
    );
  }

  @Get('solar-design/imagery-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.INSTALLER)
  @ApiOperation({
    summary: 'Configured imagery provider + tile URL template',
    description:
      'Resolves `SOLAR_IMAGERY_PROVIDER` server-side so provider keys never reach the client bundle. Keyless providers (Esri) return their real tile host directly. Keyed providers (google/mapbox) return `/solar-design/tiles/{z}/{x}/{y}?token=<short-lived-jwt>` — the `{z}/{x}/{y}` placeholders are literal (substituted by the map library per tile) and `?token=...` is a fixed suffix, the same for every tile for the ~10 minute life of the token. The tile route is unauthenticated by `Authorization` header (it is loaded as a plain `<img src>`/`<TileLayer>` request) and instead validates that token via a dedicated guard.',
  })
  async imageryToken(@Req() req: AuthRequest) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }
    const resolved = await this.imagery.resolveProvider();
    const base = await this.imagery.getImageryToken();
    if (resolved.keyless) {
      return base;
    }
    const token = await this.tileTokens.issue(userId);
    return { ...base, urlTemplate: `${base.urlTemplate}?token=${token}` };
  }

  @Post('solar-design/imagery-test')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(UserRole.ADMIN)
  // One real outbound fetch to the provider under test — same bucket as the
  // tile proxy, not the default CRUD-sized one.
  @SkipThrottle({ default: true })
  @Throttle({ 'solar-imagery-outbound': {} })
  @ApiOperation({
    summary: 'Verify an imagery provider/key by fetching one real tile',
    description:
      'Admin-only. Never persists anything. `apiKey` tests a not-yet-saved candidate key; omit it to re-test the currently saved key for that provider. Reports success plus the effective max native zoom and metres-per-pixel at the sample coordinate — never a raw upstream error/stack trace, always a clean message.',
  })
  async testImageryProvider(@Body() dto: TestImageryProviderDto) {
    const resolved = await this.imagery.resolveForTest({
      provider: dto.provider,
      apiKey: dto.apiKey,
    });
    // Sydney CBD by default — an arbitrary real-world coordinate so the test
    // tile plausibly exists upstream, not a null-island edge case.
    const sampleLat = dto.sampleLat ?? -33.8688;
    const sampleLon = dto.sampleLon ?? 151.2093;
    const testZoom = Math.min(15, resolved.maxNativeZoom);
    const { x, y } = latLonToTile(sampleLat, sampleLon, testZoom);
    await this.tileProxy.fetchTileFromResolved(resolved, testZoom, x, y);

    return {
      success: true,
      provider: resolved.provider,
      maxNativeZoom: resolved.maxNativeZoom,
      sampleLat,
      sampleLon,
      metresPerPixel: metresPerPixelAt(sampleLat, resolved.maxNativeZoom),
    };
  }

  @Get('solar-design/tiles/:z/:x/:y')
  @UseGuards(SolarTileTokenGuard, ThrottlerGuard)
  // Each request is one outbound fetch to the upstream imagery provider on
  // the app's behalf; this route is also the only one on `<img src>`/tile
  // grid load, so it needs its own bucket sized for a real map pan/zoom
  // session rather than the app's default CRUD-sized one.
  @SkipThrottle({ default: true })
  @Throttle({ 'solar-imagery-outbound': {} })
  @ApiOperation({
    summary: 'Same-origin tile proxy for the configured imagery provider',
    description:
      'Fetches the upstream tile server-side (injecting the provider key when configured) so credentials never reach the browser and every provider is same-origin. Loaded as a plain `<img src>` by the map library, so it is authenticated by a short-lived `?token=` query param (minted by `GET /solar-design/imagery-token`, scoped to "may fetch tiles" only) instead of the usual `Authorization` header / JwtAuthGuard. Only ever fetches the configured provider host; z/x/y are range-checked; redirects are re-validated against that host. Cached aggressively — upstream tiles are immutable for a given provider/z/x/y.',
  })
  @ApiParam({ name: 'z', description: 'Zoom level' })
  @ApiParam({ name: 'x', description: 'Tile column' })
  @ApiParam({ name: 'y', description: 'Tile row' })
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  async getTile(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Res() res: Response,
  ) {
    const tile = await this.tileProxy.fetchTile(z, x, y);
    res.setHeader('Content-Type', tile.contentType);
    res.send(tile.buffer);
  }
}
