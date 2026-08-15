import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FilesModule } from '../files/files.module';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
import { RoofDesign } from './entities/roof-design.entity';
import { RoofDesignService } from './roof-design.service';
import { RoofDesignRenderService } from './roof-design-render.service';
import { SolarSimulationService } from './solar-simulation.service';
import { SolarImageryService } from './solar-imagery.service';
import { SolarTileProxyService } from './solar-tile-proxy.service';
import { SolarTileTokenService } from './solar-tile-token.service';
import { SolarTileTokenGuard } from './guards/solar-tile-token.guard';
import { RoofDesignRenderCompositeService } from './roof-design-render-composite.service';
import { SolarDesignController } from './solar-design.controller';
import { IrradianceCache } from './irradiance/irradiance-cache.entity';
import { IrradianceCacheService } from './irradiance/irradiance-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoofDesign,
      SolarPanel,
      IrradianceCache,
      Job,
      Customer,
    ]),
    JobsModule,
    PermissionsModule,
    FilesModule,
    // Own JwtModule registration (not AuthModule's) — signs/verifies the
    // narrowly-scoped, short-lived tile token only; same JWT_SECRET, no
    // shared DI surface with the interactive-login JwtAuthGuard.
    JwtModule.register({ secret: resolveJwtSecret() }),
  ],
  controllers: [SolarDesignController],
  providers: [
    RoofDesignService,
    RoofDesignRenderService,
    SolarSimulationService,
    SolarImageryService,
    SolarTileProxyService,
    SolarTileTokenService,
    SolarTileTokenGuard,
    RoofDesignRenderCompositeService,
    IrradianceCacheService,
  ],
  exports: [RoofDesignService, SolarSimulationService, IrradianceCacheService],
})
export class SolarDesignModule {}
