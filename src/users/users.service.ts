import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async createAdminIfMissing(): Promise<User> {
    const existingAdmin = await this.usersRepository.findOne({
      where: { emailAddress: 'admin@local.dev' },
    });

    if (existingAdmin) {
      return existingAdmin;
    }

    const admin = this.usersRepository.create({
      firstName: 'Admin',
      lastName: 'User',
      emailAddress: 'admin@local.dev',
      phoneNumber: '+10000000000',
      role: UserRole.ADMIN,
    });

    return this.usersRepository.save(admin);
  }
}
