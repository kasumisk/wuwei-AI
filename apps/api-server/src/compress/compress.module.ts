import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CompressController } from './compress.controller';
import { CompressService } from './compress.service';

@Module({
  imports: [MulterModule.register({ storage: memoryStorage() })],
  controllers: [CompressController],
  providers: [CompressService],
})
export class CompressModule {}
