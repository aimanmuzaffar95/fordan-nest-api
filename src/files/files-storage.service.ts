import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import type { ReadStream } from 'fs';

@Injectable()
export class FilesStorageService {
  private readonly logger = new Logger(FilesStorageService.name);
  private readonly baseDir: string;
  private readonly driver: 'local' | 's3';

  constructor() {
    const d = (process.env.STORAGE_DRIVER ?? 'local').trim().toLowerCase();
    this.driver = d === 's3' ? 's3' : 'local';
    this.baseDir = path.resolve(
      process.cwd(),
      process.env.LOCAL_UPLOAD_DIR ?? './uploads',
    );
  }

  isLocalDriver(): boolean {
    return this.driver === 'local';
  }

  getAbsolutePath(storageKey: string): string {
    const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) {
      throw new BadRequestException('Invalid storage key');
    }
    return path.join(this.baseDir, ...normalized.split('/'));
  }

  async writeBuffer(storageKey: string, buffer: Buffer): Promise<void> {
    if (this.driver !== 'local') {
      throw new BadRequestException(
        'S3 uploads are not implemented yet. Set STORAGE_DRIVER=local.',
      );
    }
    const full = this.getAbsolutePath(storageKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);
    this.logger.debug(`Wrote upload ${storageKey}`);
  }

  createReadStream(storageKey: string): ReadStream {
    const full = this.getAbsolutePath(storageKey);
    return createReadStream(full);
  }

  fileExistsOnDisk(storageKey: string): boolean {
    return existsSync(this.getAbsolutePath(storageKey));
  }
}
