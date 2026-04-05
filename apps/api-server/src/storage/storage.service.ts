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
  /** 存储的文件 key */
  key: string;
  /** 公开访问 URL（如配置了公开域名） */
  url: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件 MD5 */
  md5: string;
  /** MIME 类型 */
  mimeType: string;
  /** 原始文件名 */
  originalName: string;
}

export interface PresignedUrlResult {
  /** 预签名上传 URL */
  uploadUrl: string;
  /** 文件 key */
  key: string;
  /** 公开访问 URL */
  url: string;
  /** URL 过期时间（秒） */
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
    const secretAccessKey =
      this.configService.get<string>('STORAGE_SECRET_KEY');
    this.bucket = this.configService.get<string>('STORAGE_BUCKET') || 'uploads';
    this.publicUrl = this.configService.get<string>('STORAGE_PUBLIC_URL') || '';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'S3 storage not configured. Set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY in env.',
      );
      return;
    }

    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    this.logger.log(
      `S3 storage initialized: bucket=${this.bucket}, endpoint=${endpoint}`,
    );
  }

  private ensureClient() {
    if (!this.s3Client) {
      throw new Error(
        'S3 storage is not configured. Check your environment variables.',
      );
    }
  }

  /**
   * 生成存储 key
   * 格式: {folder}/{date}/{uuid}{ext}
   */
  private generateKey(folder: string, originalName: string): string {
    const ext = path.extname(originalName).toLowerCase();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const uuid = crypto.randomUUID();
    return `${folder}/${date}/${uuid}${ext}`;
  }

  /**
   * 计算文件 MD5
   */
  private computeMd5(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * 获取文件公开 URL
   */
  private getPublicUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/+$/, '')}/${key}`;
    }
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT') || '';
    return `${endpoint.replace(/\/+$/, '')}/${this.bucket}/${key}`;
  }

  /**
   * 上传文件（Buffer）
   */
  async upload(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    folder: string = 'general',
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
        Metadata: {
          'original-name': encodeURIComponent(originalName),
          md5,
        },
      }),
    );

    this.logger.log(`File uploaded: ${key} (${buffer.length} bytes)`);

    return {
      key,
      url: this.getPublicUrl(key),
      size: buffer.length,
      md5,
      mimeType,
      originalName,
    };
  }

  /**
   * 生成预签名上传 URL
   * 客户端可直接向该 URL PUT 上传文件，无需经过服务器
   */
  async getPresignedUploadUrl(
    originalName: string,
    mimeType: string,
    folder: string = 'general',
    expiresIn: number = 3600,
  ): Promise<PresignedUrlResult> {
    this.ensureClient();

    const key = this.generateKey(folder, originalName);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      uploadUrl,
      key,
      url: this.getPublicUrl(key),
      expiresIn,
    };
  }

  /**
   * 生成预签名下载 URL（用于私有文件）
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    this.ensureClient();

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * 删除文件
   */
  async delete(key: string): Promise<void> {
    this.ensureClient();

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    this.logger.log(`File deleted: ${key}`);
  }

  /**
   * 获取文件元信息
   */
  async getMetadata(key: string) {
    this.ensureClient();

    const result = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return {
      key,
      size: result.ContentLength,
      mimeType: result.ContentType,
      lastModified: result.LastModified,
      metadata: result.Metadata,
    };
  }

  /**
   * 列出文件
   */
  async listFiles(prefix: string, maxKeys: number = 100) {
    this.ensureClient();

    const result = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    );

    return (result.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));
  }
}
