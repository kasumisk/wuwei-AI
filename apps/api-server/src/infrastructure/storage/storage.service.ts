import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as path from 'path';

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  md5: string;
  mimeType: string;
  originalName: string;
}

export interface PresignedUrlResult {
  uploadUrl: string;
  key: string;
  url: string;
  expiresIn: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    const region = this.configService.get<string>('STORAGE_REGION') || 'auto';
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('STORAGE_SECRET_KEY');
    this.bucket = this.configService.get<string>('STORAGE_BUCKET') || 'uploads';
    this.publicUrl = this.configService.get<string>('STORAGE_PUBLIC_URL') || '';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn('S3 storage not configured.');
      return;
    }

    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    this.logger.log(`S3 storage initialized: bucket=${this.bucket}`);
  }

  private ensureClient() {
    if (!this.s3Client) {
      throw new Error('S3 storage is not configured.');
    }
  }

  private generateKey(folder: string, originalName: string): string {
    const ext = path.extname(originalName).toLowerCase();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const uuid = crypto.randomUUID();
    return `${folder}/${date}/${uuid}${ext}`;
  }

  private computeMd5(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  private getPublicUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/+$/, '')}/${key}`;
    }
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT') || '';
    return `${endpoint.replace(/\/+$/, '')}/${this.bucket}/${key}`;
  }

  async upload(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    folder = 'general',
  ): Promise<UploadResult> {
    this.ensureClient();
    const key = this.generateKey(folder, originalName);
    const md5 = this.computeMd5(buffer);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: buffer.length,
        Metadata: { 'original-name': encodeURIComponent(originalName), md5 },
      }),
    );

    return { key, url: this.getPublicUrl(key), size: buffer.length, md5, mimeType, originalName };
  }

  async getPresignedUploadUrl(
    originalName: string,
    mimeType: string,
    folder = 'general',
    expiresIn = 3600,
  ): Promise<PresignedUrlResult> {
    this.ensureClient();
    const key = this.generateKey(folder, originalName);
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType });
    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
    return { uploadUrl, key, url: this.getPublicUrl(key), expiresIn };
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    this.ensureClient();
    return getSignedUrl(this.s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async delete(key: string): Promise<void> {
    this.ensureClient();
    await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getMetadata(key: string) {
    this.ensureClient();
    const result = await this.s3Client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { key, size: result.ContentLength, mimeType: result.ContentType, lastModified: result.LastModified };
  }

  async listFiles(prefix: string, maxKeys = 100) {
    this.ensureClient();
    const result = await this.s3Client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: maxKeys }),
    );
    return (result.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));
  }
}
