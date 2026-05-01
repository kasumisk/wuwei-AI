import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CompressController } from './compress.controller';
import { CompressService } from './compress.service';

/**
 * V6.7 P0: 文件上传安全
 * - fileSize: 50MB（与 controller MAX_FILE_SIZE 一致）
 * - files: 20（与 FilesInterceptor 一致）
 * - 在 multer 层强制限制，超限立即断流（防 OOM / 流量放大攻击）
 * - 仅接受 image/* 类型（在 controller ParseFilePipe 二次校验）
 */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: MAX_FILES,
        fields: 10,
        parts: MAX_FILES + 10,
      },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
          cb(new Error('Only image files are allowed') as any, false);
          return;
        }
        cb(null, true);
      },
    }),
  ],
  controllers: [CompressController],
  providers: [CompressService],
})
export class CompressModule {}
