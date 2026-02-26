import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { UserCredential } from './entities/user-credential.entity';
import { UserRole } from '../users/entities/user-role.enum';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(UserCredential)
    private readonly credentialsRepository: Repository<UserCredential>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultAdmin();
  }

  async login(loginDto: LoginDto): Promise<{ accessToken: string }> {
    const credential = await this.credentialsRepository.findOne({
      where: { username: loginDto.username },
    });

    if (!credential) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await compare(
      loginDto.password,
      credential.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: credential.user.id,
      isAdmin: credential.user.role === UserRole.ADMIN,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
  }

  private async seedDefaultAdmin(): Promise<void> {
    const existingCredential = await this.credentialsRepository.findOne({
      where: { username: 'admin' },
    });

    if (existingCredential) {
      return;
    }

    const adminUser = await this.usersService.createAdminIfMissing();

    const adminCredential = this.credentialsRepository.create({
      username: 'admin',
      passwordHash: await hash('admin', 10),
      user: adminUser,
    });

    await this.credentialsRepository.save(adminCredential);
  }
}
