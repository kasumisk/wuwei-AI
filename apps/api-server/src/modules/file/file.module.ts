import { Module } from '@nestjs/common';
// App 端
import { AppFileController } from './app/file.controller';
// Admin 端
import { FileController } from './admin/file.controller';

@Module({
  controllers: [AppFileController, FileController],
})
export class FileModule {}
