import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  BucketLocationConstraint,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { File as FileEntity } from './entities/file.entity';
import { COMPLIANCE_UPLOAD_KIND, UploadKind } from './upload.constants';
import { resolveUploadsConfig, UploadsConfig } from './uploads.config';

type StoreFileInput = {
  ownerType: string;
  ownerId: string;
  kind: UploadKind;
  originalName: string;
  contentType: string;
  buffer: Buffer;
};

type StoreFileResult = {
  storageDriver: 'local' | 's3';
  storageBucket: string | null;
  storageKey: string;
};

type StoredFileStream = {
  stream: Readable;
  contentLength?: number;
};

@Injectable()
export class FilesStorageService {
  private readonly logger = new Logger(FilesStorageService.name);
  private readonly config: UploadsConfig = resolveUploadsConfig();
  private readonly s3Client =
    this.config.driver === 's3'
      ? new S3Client({
          region: this.config.s3.region,
          endpoint: this.config.s3.endpoint,
          credentials: {
            accessKeyId: this.config.s3.accessKeyId,
            secretAccessKey: this.config.s3.secretAccessKey,
          },
          forcePathStyle: this.config.s3.forcePathStyle,
        })
      : null;

  private readonly bucketReadyPromises = new Map<string, Promise<void>>();

  get maxUploadSizeBytes(): number {
    return this.config.maxUploadSizeBytes;
  }

  get allowedMimeTypes(): string[] {
    return this.config.allowedMimeTypes;
  }

  async store(input: StoreFileInput): Promise<StoreFileResult> {
    if (this.config.driver === 'local') {
      return this.storeLocally(input);
    }

    return this.storeInS3(input);
  }

  async deleteStoredFile(
    file: Pick<FileEntity, 'storageBucket' | 'storageDriver' | 'storageKey'>,
  ): Promise<void> {
    if (file.storageDriver === 'local') {
      const fullPath = join(
        resolve(process.cwd(), this.config.localUploadDir),
        file.storageKey,
      );
      await fs.unlink(fullPath).catch(() => undefined);
      return;
    }

    const storageBucket = file.storageBucket?.trim();
    if (!this.s3Client || !storageBucket) {
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: storageBucket,
          Key: file.storageKey,
        }),
      );
    } catch {
      /* best-effort cleanup */
    }
  }

  async getStoredFile(
    file: Pick<
      FileEntity,
      'kind' | 'storageBucket' | 'storageDriver' | 'storageKey'
    >,
  ) {
    if (file.storageDriver === 'local') {
      return this.getLocalFile(file.storageKey);
    }

    const storageBucket = file.storageBucket?.trim();
    if (!storageBucket) {
      throw new InternalServerErrorException(
        'File record is missing storageBucket — re-upload required or run backfill migration',
      );
    }

    return this.getS3File(file.storageKey, storageBucket);
  }

  private async storeLocally(input: StoreFileInput): Promise<StoreFileResult> {
    const storageKey = this.buildStorageKey(
      input.ownerType,
      input.ownerId,
      input.originalName,
    );
    const rootDir = resolve(process.cwd(), this.config.localUploadDir);
    const targetPath = join(rootDir, storageKey);

    await fs.mkdir(dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, input.buffer);

    return {
      storageDriver: 'local',
      storageBucket: null,
      storageKey,
    };
  }

  private async getLocalFile(storageKey: string): Promise<StoredFileStream> {
    const fullPath = join(
      resolve(process.cwd(), this.config.localUploadDir),
      storageKey,
    );

    try {
      const stats = await fs.stat(fullPath);
      return {
        stream: createReadStream(fullPath),
        contentLength: stats.size,
      };
    } catch {
      throw new InternalServerErrorException(
        'Stored file is missing from local disk',
      );
    }
  }

  private async storeInS3(input: StoreFileInput): Promise<StoreFileResult> {
    const bucketName = this.resolveBucketName(input);
    await this.ensureS3BucketReady(bucketName);
    if (!this.s3Client) {
      throw new InternalServerErrorException('S3 client is not configured');
    }

    const storageKey = this.buildStorageKey(
      input.ownerType,
      input.ownerId,
      input.originalName,
    );

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: storageKey,
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );

    return {
      storageDriver: 's3',
      storageBucket: bucketName,
      storageKey,
    };
  }

  private async getS3File(
    storageKey: string,
    bucketName: string,
  ): Promise<StoredFileStream> {
    await this.ensureS3BucketReady(bucketName);
    if (!this.s3Client) {
      throw new InternalServerErrorException('S3 client is not configured');
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: storageKey,
      }),
    );

    const stream = this.toReadable(response.Body);
    if (!stream) {
      throw new InternalServerErrorException(
        'Unable to read file stream from S3',
      );
    }

    return {
      stream,
      contentLength: response.ContentLength,
    };
  }

  private buildStorageKey(
    ownerType: string,
    ownerId: string,
    originalName: string,
  ): string {
    const ext = extname(originalName).toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    return `${ownerType}/${ownerId}/${today}/${randomUUID()}${ext}`;
  }

  private async ensureS3BucketReady(bucketName: string): Promise<void> {
    if (this.config.driver !== 's3') {
      return;
    }

    if (!bucketName) {
      throw new InternalServerErrorException(
        'S3 bucket must be configured when STORAGE_DRIVER=s3',
      );
    }

    if (!this.config.s3.accessKeyId || !this.config.s3.secretAccessKey) {
      throw new InternalServerErrorException(
        'S3 credentials must be configured when STORAGE_DRIVER=s3',
      );
    }

    const existingPromise = this.bucketReadyPromises.get(bucketName);
    if (!existingPromise) {
      const nextPromise = this.ensureS3BucketReadyOnce(bucketName).catch(
        (error) => {
          this.bucketReadyPromises.delete(bucketName);
          throw error;
        },
      );
      this.bucketReadyPromises.set(bucketName, nextPromise);
    }

    await this.bucketReadyPromises.get(bucketName);
  }

  private async ensureS3BucketReadyOnce(bucketName: string): Promise<void> {
    if (!this.s3Client) {
      throw new InternalServerErrorException('S3 client is not configured');
    }

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return;
    } catch (error) {
      if (
        !this.config.s3.autoCreateBucket ||
        !this.isMissingBucketError(error)
      ) {
        throw error;
      }
    }

    this.logger.log(`Creating missing S3 bucket "${bucketName}"`);

    await this.s3Client.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        ...(this.config.s3.region === 'us-east-1'
          ? {}
          : {
              CreateBucketConfiguration: {
                LocationConstraint: this.config.s3
                  .region as BucketLocationConstraint,
              },
            }),
      }),
    );
  }

  private resolveBucketName(input: {
    kind: UploadKind;
    storageBucket?: string | null;
  }) {
    if (input.storageBucket?.trim()) {
      return input.storageBucket.trim();
    }

    if (input.kind === COMPLIANCE_UPLOAD_KIND) {
      return this.config.s3.complianceUploadsBucket;
    }

    return this.config.s3.fileUploadsBucket;
  }

  private isMissingBucketError(error: unknown): boolean {
    const typedError = error as {
      name?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      typedError?.name === 'NotFound' ||
      typedError?.name === 'NoSuchBucket' ||
      typedError?.Code === 'NoSuchBucket' ||
      typedError?.$metadata?.httpStatusCode === 404
    );
  }

  private toReadable(body: unknown): Readable | null {
    if (!body) {
      return null;
    }

    if (body instanceof Readable) {
      return body;
    }

    if (typeof body === 'object' && body !== null && 'pipe' in body) {
      return body as Readable;
    }

    const bodyWithWebStream = body as {
      transformToWebStream?: () => ReadableStream;
    };

    if (typeof bodyWithWebStream.transformToWebStream === 'function') {
      return Readable.fromWeb(bodyWithWebStream.transformToWebStream());
    }

    return null;
  }
}
