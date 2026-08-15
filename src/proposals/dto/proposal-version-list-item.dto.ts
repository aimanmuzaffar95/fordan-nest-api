import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProposalStatus } from '../entities/proposal-version.entity';

/**
 * One row of `GET /proposal-versions` — denormalised so the client never
 * has to join back to the job/customer for what the index displays.
 */
export class ProposalVersionListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() jobId: string;
  @ApiProperty() jobOrderNumber: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: ProposalStatus }) status: ProposalStatus;
  @ApiPropertyOptional({ nullable: true }) totalPrice: string | null;
  @ApiPropertyOptional({ nullable: true }) systemSizeKw: string | null;
  @ApiPropertyOptional({ nullable: true }) sentAt: string | null;
  @ApiProperty() versionNumber: number;
  @ApiProperty() createdAt: string;
}

export class ProposalVersionListResponseDto {
  @ApiProperty({ type: [ProposalVersionListItemDto] })
  items: ProposalVersionListItemDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}
