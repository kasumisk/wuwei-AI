import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppVersion } from './entities/app-version.entity';
import { AppVersionPackage } from './entities/app-version-package.entity';
import { AppVersionService } from './services/app-version.service';
import { AppVersionController } from './controllers/app-version.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AppVersion, AppVersionPackage])],
  controllers: [AppVersionController],
  providers: [AppVersionService],
  exports: [AppVersionService],
})
export class AdminManagementModule {}
