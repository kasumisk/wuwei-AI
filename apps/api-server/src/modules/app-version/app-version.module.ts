import { Module } from '@nestjs/common';
// App 端
import { AppUpdateController } from './app/update.controller';
import { AppUpdateService } from './app/app-update.service';
// Admin 端
import { AppVersionController } from './admin/app-version.controller';
import { AppVersionPackageController } from './admin/app-version-package.controller';
import { AppVersionService } from './admin/app-version.service';
import { AppVersionPackageService } from './admin/app-version-package.service';

@Module({
  controllers: [
    AppUpdateController,
    AppVersionController,
    AppVersionPackageController,
  ],
  providers: [AppUpdateService, AppVersionService, AppVersionPackageService],
  exports: [AppUpdateService, AppVersionService, AppVersionPackageService],
})
export class AppVersionModule {}
