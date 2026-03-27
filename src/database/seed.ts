import { AppDataSource } from './data-source';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { hash } from 'bcryptjs';
import { Job } from '../jobs/entities/job.entity';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { JobSystemType } from '../jobs/job-system-type.enum';
import { StaffRole } from '../staff/entities/staff-role.entity';
import { Team } from '../teams/entities/team.entity';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { SolarPanelStockStatus } from '../solar-panels/entities/solar-panel-stock-status.enum';
import { Inverter } from '../inverters/entities/inverter.entity';
import { InverterStockStatus } from '../inverters/entities/inverter-stock-status.enum';
import { Battery } from '../batteries/entities/battery.entity';
import { BatteryStockStatus } from '../batteries/entities/battery-stock-status.enum';

type SeedUser = {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  role: UserRole;
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const offsetDate = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDate(date);
};

const seedUsers = (): SeedUser[] => {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@local.dev';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin';

  return [
    {
      username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      emailAddress: adminEmail,
      phoneNumber: process.env.SEED_ADMIN_PHONE ?? '+10000000000',
      role: UserRole.ADMIN,
    },
    {
      username: 'manager',
      password: 'manager',
      firstName: 'Manager',
      lastName: 'User',
      emailAddress: 'manager@local.dev',
      phoneNumber: '+10000000001',
      role: UserRole.MANAGER,
    },
    {
      username: 'installer',
      password: 'installer',
      firstName: 'Installer',
      lastName: 'User',
      emailAddress: 'installer@local.dev',
      phoneNumber: '+10000000002',
      role: UserRole.INSTALLER,
    },
  ];
};

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const usersRepo = AppDataSource.getRepository(User);
    const credRepo = AppDataSource.getRepository(UserCredential);
    const customersRepo = AppDataSource.getRepository(Customer);
    const jobsRepo = AppDataSource.getRepository(Job);
    const staffRolesRepo = AppDataSource.getRepository(StaffRole);
    const solarPanelsRepo = AppDataSource.getRepository(SolarPanel);
    const invertersRepo = AppDataSource.getRepository(Inverter);
    const batteriesRepo = AppDataSource.getRepository(Battery);

    const defaultStaffRoles = [
      {
        name: 'Electrician',
        description:
          'Licensed electrician for wiring and electrical connections',
      },
      {
        name: 'Solar Panel Installer',
        description:
          'Handles mounting and installation of solar panels on rooftops',
      },
      {
        name: 'Inverter Technician',
        description:
          'Specialises in inverter setup, configuration and troubleshooting',
      },
    ] as const;
    const teamsRepo = AppDataSource.getRepository(Team);

    for (const u of seedUsers()) {
      let user = await usersRepo.findOne({
        where: { emailAddress: u.emailAddress },
      });
      if (!user) {
        user = usersRepo.create({
          firstName: u.firstName,
          lastName: u.lastName,
          emailAddress: u.emailAddress,
          phoneNumber: u.phoneNumber,
          address: null,
          identificationNumber: null,
          role: u.role,
          staffRoleId: null,
          deletedAt: null,
        });
        user = await usersRepo.save(user);
      }

      const existing = await credRepo.findOne({
        where: { username: u.username },
      });
      if (existing) continue;

      await credRepo.save(
        credRepo.create({
          username: u.username,
          passwordHash: await hash(u.password, 10),
          user,
        }),
      );
    }

    for (const role of defaultStaffRoles) {
      const existingRole = await staffRolesRepo
        .createQueryBuilder('role')
        .where('LOWER(role.name) = LOWER(:name)', { name: role.name })
        .getOne();

      if (existingRole) {
        continue;
      }

      await staffRolesRepo.save(staffRolesRepo.create(role));
    }

    if ((await customersRepo.count()) === 0) {
      await customersRepo.save([
        customersRepo.create({
          firstName: 'John',
          lastName: 'Smith',
          address: '12 Oak Street, Brisbane QLD 4000',
          phone: '0412345678',
          email: 'john.smith@local.dev',
        }),
        customersRepo.create({
          firstName: 'Sarah',
          lastName: 'Johnson',
          address: '45 River Road, Gold Coast QLD 4217',
          phone: '0423456789',
          email: 'sarah.johnson@local.dev',
        }),
        customersRepo.create({
          firstName: 'Michael',
          lastName: 'Brown',
          address: '78 Hill Avenue, Sunshine Coast QLD 4556',
          phone: '0434567890',
          email: 'michael.brown@local.dev',
        }),
      ]);
    }

    // Baseline operational setup: teams are required for scheduling/assignment capacity.
    if ((await teamsRepo.count()) === 0) {
      const teamsToInsert = teamsRepo.create([
        { name: 'Team A', dailyCapacityKw: '100.00' },
        { name: 'Team B', dailyCapacityKw: '100.00' },
        { name: 'Team C', dailyCapacityKw: '100.00' },
      ]);
      await teamsRepo.save(teamsToInsert);
    }

    if ((await solarPanelsRepo.count()) === 0) {
      await solarPanelsRepo.save(
        solarPanelsRepo.create([
          {
            brand: 'Longi Solar',
            model: 'LR5-54HTH-440M',
            wattage: '440.00',
            defaultUnitPrice: '250.00',
            stockStatus: SolarPanelStockStatus.AVAILABLE,
            efficiency: '22.50',
            dimensions: '1722 x 1134 x 30 mm',
            weightKg: '20.80',
            warrantyYears: 25,
            notes: 'High-efficiency mono module for residential installs.',
          },
          {
            brand: 'Trina Solar',
            model: 'TSM-NEG9R.28',
            wattage: '440.00',
            defaultUnitPrice: '245.00',
            stockStatus: SolarPanelStockStatus.OUT_OF_STOCK,
            efficiency: '22.00',
            dimensions: '1762 x 1134 x 30 mm',
            weightKg: '21.00',
            warrantyYears: 25,
            notes: 'Dual-glass module suited for premium rooftop systems.',
          },
          {
            brand: 'Canadian Solar',
            model: 'CS7L-595MS',
            wattage: '595.00',
            defaultUnitPrice: '310.00',
            stockStatus: SolarPanelStockStatus.DISCONTINUED,
            efficiency: '21.30',
            dimensions: '2172 x 1303 x 35 mm',
            weightKg: '31.00',
            warrantyYears: 25,
            notes: 'Legacy utility-scale panel kept for historical reference.',
          },
        ]),
      );
    }

    if ((await invertersRepo.count()) === 0) {
      await invertersRepo.save(
        invertersRepo.create([
          {
            brand: 'Huawei',
            model: 'M1 High Current',
            capacityKw: '10.00',
            defaultUnitPrice: '1850.00',
            stockStatus: InverterStockStatus.AVAILABLE,
            inverterType: 'Hybrid',
            phases: 'Three phase',
            efficiency: '98.60',
            warrantyYears: 10,
            notes: 'Popular hybrid inverter for premium residential systems.',
          },
          {
            brand: 'Fronius',
            model: '8.2-1',
            capacityKw: '8.20',
            defaultUnitPrice: '1650.00',
            stockStatus: InverterStockStatus.OUT_OF_STOCK,
            inverterType: 'String',
            phases: 'Single phase',
            efficiency: '97.90',
            warrantyYears: 10,
            notes:
              'Single-phase string inverter for medium residential arrays.',
          },
          {
            brand: 'GoodWe',
            model: 'GW15K-ET',
            capacityKw: '15.00',
            defaultUnitPrice: '2400.00',
            stockStatus: InverterStockStatus.DISCONTINUED,
            inverterType: 'Hybrid',
            phases: 'Three phase',
            efficiency: '98.20',
            warrantyYears: 5,
            notes:
              'Legacy three-phase inverter retained for historical lookups.',
          },
        ]),
      );
    }

    if ((await batteriesRepo.count()) === 0) {
      await batteriesRepo.save(
        batteriesRepo.create([
          {
            brand: 'Tesla',
            model: 'PW-3-GEN',
            capacityKwh: '13.50',
            defaultUnitPrice: '8900.00',
            stockStatus: BatteryStockStatus.AVAILABLE,
            voltage: '350.00',
            chemistry: 'LFP',
            cycleLife: 6000,
            warrantyYears: 10,
            notes: 'Flagship residential battery with integrated inverter.',
          },
          {
            brand: 'BYD',
            model: 'HVS 10.2',
            capacityKwh: '10.20',
            defaultUnitPrice: '6400.00',
            stockStatus: BatteryStockStatus.OUT_OF_STOCK,
            voltage: '409.00',
            chemistry: 'LFP',
            cycleLife: 6000,
            warrantyYears: 10,
            notes: 'Modular stackable storage for premium hybrid systems.',
          },
          {
            brand: 'Sonnen',
            model: 'Eco 9.43',
            capacityKwh: '10.00',
            defaultUnitPrice: '6100.00',
            stockStatus: BatteryStockStatus.DISCONTINUED,
            voltage: '120.00',
            chemistry: 'Lithium iron phosphate',
            cycleLife: 10000,
            warrantyYears: 10,
            notes:
              'Legacy battery retained for upgrade and replacement planning.',
          },
        ]),
      );
    }

    // Minimal jobs seed so the invoice/order flow has records to link against.
    if ((await jobsRepo.count()) === 0) {
      const customers = await customersRepo.find({
        order: { createdAt: 'ASC' },
      });
      if (customers.length > 0) {
        const jobsToInsert = [
          jobsRepo.create({
            customer: customers[0],
            customerId: customers[0].id,
            orderNumber: 'ORD-1001',
            systemType: JobSystemType.SOLAR,
            jobStatus: JobPipelineStage.LEAD,
            systemSizeKw: '5.00',
            batterySizeKwh: null,
            projectPrice: '9500.00',
            contractSigned: false,
            depositAmount: '0.00',
            depositPaid: false,
            depositDate: null,
            installDate: null,
          }),
          jobsRepo.create({
            customer: customers[1] ?? customers[0],
            customerId: (customers[1] ?? customers[0]).id,
            orderNumber: 'ORD-1002',
            systemType: JobSystemType.SOLAR,
            jobStatus: JobPipelineStage.QUOTED,
            systemSizeKw: '6.60',
            batterySizeKwh: null,
            projectPrice: '12000.00',
            contractSigned: false,
            depositAmount: '0.00',
            depositPaid: false,
            depositDate: null,
            installDate: null,
          }),
          jobsRepo.create({
            customer: customers[2] ?? customers[0],
            customerId: (customers[2] ?? customers[0]).id,
            orderNumber: 'ORD-1003',
            systemType: JobSystemType.BOTH,
            jobStatus: JobPipelineStage.SCHEDULED,
            systemSizeKw: '10.00',
            batterySizeKwh: '13.50',
            projectPrice: '18500.00',
            contractSigned: true,
            depositAmount: '3000.00',
            depositPaid: true,
            depositDate: offsetDate(-30),
            installDate: offsetDate(2),
          }),
          jobsRepo.create({
            customer: customers[0],
            customerId: customers[0].id,
            orderNumber: 'ORD-1004',
            systemType: JobSystemType.BATTERY,
            jobStatus: JobPipelineStage.PRE_METER_SUBMITTED,
            systemSizeKw: null,
            batterySizeKwh: '10.00',
            projectPrice: '15000.00',
            contractSigned: true,
            depositAmount: '2500.00',
            depositPaid: true,
            depositDate: offsetDate(-12),
            installDate: null,
          }),
          jobsRepo.create({
            customer: customers[1] ?? customers[0],
            customerId: (customers[1] ?? customers[0]).id,
            orderNumber: 'ORD-1005',
            systemType: JobSystemType.BOTH,
            jobStatus: JobPipelineStage.INSTALLED,
            systemSizeKw: '12.00',
            batterySizeKwh: '13.50',
            projectPrice: '28000.00',
            contractSigned: true,
            depositAmount: '4000.00',
            depositPaid: true,
            depositDate: offsetDate(-45),
            installDate: offsetDate(-3),
          }),
          jobsRepo.create({
            customer: customers[2] ?? customers[0],
            customerId: (customers[2] ?? customers[0]).id,
            orderNumber: 'ORD-1006',
            systemType: JobSystemType.SOLAR,
            jobStatus: JobPipelineStage.PAID,
            systemSizeKw: '8.80',
            batterySizeKwh: null,
            projectPrice: '16500.00',
            contractSigned: true,
            depositAmount: '2500.00',
            depositPaid: true,
            depositDate: offsetDate(-60),
            installDate: offsetDate(-25),
          }),
        ];

        await jobsRepo.save(jobsToInsert);
      }
    }
  } finally {
    await AppDataSource.destroy().catch(() => {
      // ignore
    });
  }
}
void main();
