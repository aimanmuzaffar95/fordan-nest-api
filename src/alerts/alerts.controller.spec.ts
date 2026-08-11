import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { AlertsQueryDto } from './dto/alerts-query.dto';

type AuthRequest = Request & { user?: { sub?: string; role?: UserRole } };

// ─── Mock Service ─────────────────────────────────────────────────────────────

const mockAlertsService = () => ({
  findAlerts: jest.fn(),
  evaluateEndpoint: jest.fn(),
  resolveAlert: jest.fn(),
  resolveAll: jest.fn(),
});

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

// ─── Helper ───────────────────────────────────────────────────────────────────

const makeRequest = (userId: string, role: UserRole): AuthRequest =>
  ({ user: { sub: userId, role } }) as AuthRequest;

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('AlertsController', () => {
  let controller: AlertsController;
  let service: ReturnType<typeof mockAlertsService>;

  beforeEach(async () => {
    service = mockAlertsService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [{ provide: AlertsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<AlertsController>(AlertsController);
  });

  // ─── GET /alerts ─────────────────────────────────────────────────────────────

  describe('GET /alerts', () => {
    it('calls findAlerts without managerId filter for admin', async () => {
      service.findAlerts.mockResolvedValue({ items: [], total: 0 });
      const req = makeRequest('admin-1', UserRole.ADMIN);
      const query: AlertsQueryDto = { status: 'active' };

      await controller.findAll(query, req);

      expect(service.findAlerts).toHaveBeenCalledWith(query, {
        userId: 'admin-1',
        role: UserRole.ADMIN,
      });
    });

    it('calls findAlerts with manager viewer for manager role', async () => {
      service.findAlerts.mockResolvedValue({ items: [], total: 0 });
      const req = makeRequest('manager-1', UserRole.MANAGER);
      const query: AlertsQueryDto = { status: 'active' };

      await controller.findAll(query, req);

      expect(service.findAlerts).toHaveBeenCalledWith(query, {
        userId: 'manager-1',
        role: UserRole.MANAGER,
      });
    });

    it('returns the result from findAlerts', async () => {
      const expected = { items: [{ id: 'a1' }], total: 1 };
      service.findAlerts.mockResolvedValue(expected);
      const req = makeRequest('admin-1', UserRole.ADMIN);

      const result = await controller.findAll({}, req);

      expect(result).toEqual(expected);
    });
  });

  // ─── POST /alerts/evaluate ───────────────────────────────────────────────────

  describe('POST /alerts/evaluate', () => {
    it('calls evaluateEndpoint and returns result', async () => {
      service.evaluateEndpoint.mockResolvedValue({ evaluated: true });

      const result = await controller.evaluate();

      expect(service.evaluateEndpoint).toHaveBeenCalled();
      expect(result).toEqual({ evaluated: true });
    });
  });

  // ─── POST /alerts/:id/resolve ────────────────────────────────────────────────

  describe('POST /alerts/:id/resolve', () => {
    it('allows manager to resolve their own job alert', async () => {
      const resolved = {
        id: 'a1',
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: 'manager-1',
      };
      service.resolveAlert.mockResolvedValue(resolved);
      const req = makeRequest('manager-1', UserRole.MANAGER);

      const result = await controller.resolve('a1', req);

      expect(service.resolveAlert).toHaveBeenCalledWith(
        'a1',
        'manager-1',
        UserRole.MANAGER,
      );
      expect(result).toEqual(resolved);
    });

    it("propagates ForbiddenException when manager resolves another manager's job alert", async () => {
      service.resolveAlert.mockRejectedValue(new ForbiddenException());
      const req = makeRequest('manager-1', UserRole.MANAGER);

      await expect(controller.resolve('a1', req)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('propagates ConflictException when alert is already resolved', async () => {
      service.resolveAlert.mockRejectedValue(new ConflictException());
      const req = makeRequest('admin-1', UserRole.ADMIN);

      await expect(controller.resolve('a1', req)).rejects.toThrow(
        ConflictException,
      );
    });

    it('propagates NotFoundException when alert does not exist', async () => {
      service.resolveAlert.mockRejectedValue(new NotFoundException());
      const req = makeRequest('admin-1', UserRole.ADMIN);

      await expect(controller.resolve('nonexistent', req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── POST /alerts/resolve-all ────────────────────────────────────────────────

  describe('POST /alerts/resolve-all', () => {
    it('returns resolved count for admin', async () => {
      service.resolveAll.mockResolvedValue({ resolved: 5 });
      const req = makeRequest('admin-1', UserRole.ADMIN);

      const result = await controller.resolveAll(req);

      expect(service.resolveAll).toHaveBeenCalledWith({
        userId: 'admin-1',
        role: UserRole.ADMIN,
      });
      expect(result).toEqual({ resolved: 5 });
    });

    it('returns resolved count for manager (scoped)', async () => {
      service.resolveAll.mockResolvedValue({ resolved: 2 });
      const req = makeRequest('manager-1', UserRole.MANAGER);

      const result = await controller.resolveAll(req);

      expect(result).toEqual({ resolved: 2 });
    });
  });
});
