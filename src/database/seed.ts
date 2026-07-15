import { hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { AppDataSource } from './data-source';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';

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
  const managerPassword = process.env.SEED_MANAGER_PASSWORD ?? 'manager';
  const installerPassword = process.env.SEED_INSTALLER_PASSWORD ?? 'installer';

  const isProduction =
    (process.env.NODE_ENV ?? 'development').trim().toLowerCase() ===
    'production';
  if (
    isProduction &&
    (!process.env.SEED_ADMIN_PASSWORD ||
      !process.env.SEED_MANAGER_PASSWORD ||
      !process.env.SEED_INSTALLER_PASSWORD)
  ) {
    throw new Error(
      'Refusing to seed default passwords in production. Set SEED_ADMIN_PASSWORD, SEED_MANAGER_PASSWORD and SEED_INSTALLER_PASSWORD explicitly.',
    );
  }

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
      password: managerPassword,
      firstName: 'Manager',
      lastName: 'User',
      emailAddress: 'manager@local.dev',
      phoneNumber: '+10000000001',
      role: UserRole.MANAGER,
    },
    {
      username: 'installer',
      password: installerPassword,
      firstName: 'Installer',
      lastName: 'User',
      emailAddress: 'installer@local.dev',
      phoneNumber: '+10000000002',
      role: UserRole.INSTALLER,
    },
  ];
};

async function upsertSeedUser(
  usersRepo: Repository<User>,
  credentialsRepo: Repository<UserCredential>,
  input: SeedUser,
): Promise<void> {
  try {
    await AppDataSource.transaction(async (manager) => {
      const usersRepo = manager.getRepository(User);
      const credentialsRepo = manager.getRepository(UserCredential);

      let user = await usersRepo.findOne({
        where: { emailAddress: input.emailAddress },
      });

      if (!user) {
        user = usersRepo.create({
          firstName: input.firstName,
          lastName: input.lastName,
          emailAddress: input.emailAddress,
          phoneNumber: input.phoneNumber,
          address: null,
          identificationNumber: null,
          role: input.role,
          staffRoleId: null,
          deletedAt: null,
        });
      } else {
        user = usersRepo.merge(user, {
          firstName: input.firstName,
          lastName: input.lastName,
          phoneNumber: input.phoneNumber,
          role: input.role,
          deletedAt: null,
        });
      }

      user = await usersRepo.save(user);

      const credential = await credentialsRepo.findOne({
        where: { username: input.username },
      });

      if (!credential) {
        const passwordHash = await hash(input.password, 10);
        await credentialsRepo.save(
          credentialsRepo.create({
            username: input.username,
            passwordHash,
            mustChangePassword: false,
            user,
          }),
        );
      }
    });
  } catch (error) {
    console.error(`Failed to seed default user "${input.username}"`, error);
    return;
  }
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const usersRepo = AppDataSource.getRepository(User);
    const credentialsRepo = AppDataSource.getRepository(UserCredential);

    for (const user of seedUsers()) {
      await upsertSeedUser(usersRepo, credentialsRepo, user);
    }
  } finally {
    await AppDataSource.destroy().catch(() => {
      // ignore shutdown errors during seed teardown
    });
  }
}

void main();
