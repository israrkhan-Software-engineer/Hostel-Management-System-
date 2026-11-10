import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class PaymentProofStorageService implements OnModuleDestroy {
  private client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  async put(key: string, buffer: Buffer, mimeType: string, sha256: string): Promise<void> {
    const bucket = this.bucket();
    const client = this.getClient();
    if (this.config.get<boolean>('app.objectStorageAutoCreateBucket')) {
      await this.ensureBucket(client, bucket);
    }
    const sse = this.config.get<string>('app.objectStorageSse');
    const serverSideEncryption = sse === 'AES256'
      ? 'AES256'
      : sse === 'aws:kms'
        ? 'aws:kms'
        : sse === 'aws:kms:dsse'
          ? 'aws:kms:dsse'
          : undefined;
    if (sse && !serverSideEncryption) {
      throw new ServiceUnavailableException('OBJECT_STORAGE_SSE must be AES256, aws:kms, aws:kms:dsse, or blank');
    }
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: mimeType,
      Metadata: { sha256 },
      ServerSideEncryption: serverSideEncryption,
    }));
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.getClient().send(new GetObjectCommand({
      Bucket: this.bucket(),
      Key: key,
    }));
    if (!response.Body) {
      throw new ServiceUnavailableException('Stored payment proof returned an empty response');
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.getClient().send(new DeleteObjectCommand({
      Bucket: this.bucket(),
      Key: key,
    }));
  }

  async onModuleDestroy(): Promise<void> {
    this.client?.destroy();
  }

  private bucket(): string {
    const bucket = this.config.get<string>('app.objectStorageBucketPrivateProofs');
    if (!bucket) throw new ServiceUnavailableException('Private payment proof storage is not configured');
    return bucket;
  }

  private getClient(): S3Client {
    if (this.client) return this.client;
    const endpoint = this.config.get<string>('app.objectStorageUrl');
    const accessKey = this.config.get<string>('app.objectStorageAccessKey');
    const secretKey = this.config.get<string>('app.objectStorageSecretKey');
    if (!endpoint || !accessKey || !secretKey) {
      throw new ServiceUnavailableException('Private payment proof storage is not configured');
    }
    if (this.config.get<string>('app.nodeEnv') === 'production' && !endpoint.startsWith('https://')) {
      throw new ServiceUnavailableException('Payment proof storage must use HTTPS in production');
    }
    this.client = new S3Client({
      endpoint,
      region: this.config.get<string>('app.objectStorageRegion') || 'us-east-1',
      forcePathStyle: true,
      maxAttempts: 3,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
    return this.client;
  }

  private async ensureBucket(client: S3Client, bucket: string): Promise<void> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!isMissingBucket(error)) throw error;
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createError) {
        if (!isBucketAlreadyCreated(createError)) throw createError;
      }
    }
  }
}

function isMissingBucket(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}

function isBucketAlreadyCreated(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string };
  return candidate.name === 'BucketAlreadyExists' || candidate.name === 'BucketAlreadyOwnedByYou';
}
