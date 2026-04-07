import { PartialType } from '@nestjs/swagger';
import { CreateSolarPanelDto } from './create-solar-panel.dto';

export class UpdateSolarPanelDto extends PartialType(CreateSolarPanelDto) {}
