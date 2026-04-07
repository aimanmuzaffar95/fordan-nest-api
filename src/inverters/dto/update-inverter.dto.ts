import { PartialType } from '@nestjs/swagger';
import { CreateInverterDto } from './create-inverter.dto';

export class UpdateInverterDto extends PartialType(CreateInverterDto) {}
