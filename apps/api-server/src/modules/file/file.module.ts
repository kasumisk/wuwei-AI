import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
// App 端
import { AppFileController } from './app/file.controller';
// Admin 端
import { FileController } from './admin/file.controller';

/**
 * V6.7 P0: 文件上传上限
 * - 取 admin 端 500MB 作为 multer 硬上限（admin/file.controller MAX_FILE_SIZE = 500MB）
 * - app 端 ParseFilePipe 仍按 20MB 校验
 * - multer 边读边判断，超限立即断流，避免 OOM
 */
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1,
        fields: 10,
        parts: 11,
      },
    }),
  ],
  controllers: [AppFileController, FileController],
})
export class FileModule {}
