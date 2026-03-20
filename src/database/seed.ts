import { AppDataSource } from './data-source';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { hash } from 'bcryptjs';
import { Job } from '../jobs/entities/job.entity';
import { Team } from '../teams/entities/team.entity';

type SeedUser = {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  role: UserRole;
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
          role: u.role,
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

    // Baseline operational setup: teams are required for scheduling/assignment capacity.
    if ((await teamsRepo.count()) === 0) {
      const teamsToInsert = teamsRepo.create([
        { name: 'Team A', dailyCapacityKw: '100.00' },
        { name: 'Team B', dailyCapacityKw: '100.00' },
        { name: 'Team C', dailyCapacityKw: '100.00' },
      ]);
      await teamsRepo.save(teamsToInsert);
    }

    // Minimal jobs seed so the invoice/order flow has records to link against.
    if ((await jobsRepo.count()) === 0) {
      const customer = await customersRepo
        .createQueryBuilder('customer')
        .orderBy('customer.createdAt', 'DESC')
        .getOne();
      if (customer) {
        const jobsToInsert = [
          jobsRepo.create({
            customer,
            customerId: customer.id,
            systemType: 'both',
            projectPrice: '18500.00',
            contractSigned: true,
            depositAmount: '3000.00',
            depositPaid: false,
            depositDate: null,
          }),
          jobsRepo.create({
            customer,
            customerId: customer.id,
            systemType: 'solar',
            projectPrice: '12000.00',
            contractSigned: false,
            depositAmount: '0.00',
            depositPaid: false,
            depositDate: null,
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
