import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserCredential } from './auth/entities/user-credential.entity';
import { CustomersModule } from './customers/customers.module';
import { Customer } from './customers/entities/customer.entity';
import { User } from './users/entities/user.entity';
import { InstallerModule } from './installer/installer.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 5432),
      username:
        process.env.DATABASE_USER ?? process.env.DB_USERNAME ?? 'postgres',
      password:
        process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres',
      database:
        process.env.DATABASE_NAME ?? process.env.DB_DATABASE ?? 'nestdb',
      entities: [User, UserCredential, Customer],
      synchronize: true,
    }),
    AuthModule,
    CustomersModule,
    InstallerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
