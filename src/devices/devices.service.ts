import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { DeviceRegistration } from './entities/device-registration.entity';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceRegistration)
    private readonly repo: Repository<DeviceRegistration>,
  ) {}

  async register(
    userId: string,
    dto: RegisterDeviceDto,
  ): Promise<{ id: string; platform: string }> {
    const existing = await this.repo.findOne({
      where: { userId, platform: dto.platform, pushToken: dto.pushToken },
    });
    if (existing) {
      return { id: existing.id, platform: existing.platform };
    }

    const saved = await this.repo.save(
      this.repo.create({
        userId,
        platform: dto.platform,
        pushToken: dto.pushToken,
      }),
    );
    return { id: saved.id, platform: saved.platform };
  }
}
