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

    // Seed stage-aware jobs so the pipeline board has meaningful local data.
    if ((await jobsRepo.count()) === 0) {
      const customers = await customersRepo.find({
        order: { createdAt: 'ASC' },
      });
      if (customers.length > 0) {
        const jobsToInsert = [
          jobsRepo.create({
            customer: customers[0],
            customerId: customers[0].id,
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
