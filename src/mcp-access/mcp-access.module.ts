import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McpAccessKey } from './entities/mcp-access-key.entity';
import { User } from '../users/entities/user.entity';
import { McpAccessService } from './mcp-access.service';
import { McpAccessController } from './mcp-access.controller';

@Module({
  imports: [TypeOrmModule.forFeature([McpAccessKey, User])],
  providers: [McpAccessService],
  controllers: [McpAccessController],
  exports: [McpAccessService],
})
export class McpAccessModule {}
