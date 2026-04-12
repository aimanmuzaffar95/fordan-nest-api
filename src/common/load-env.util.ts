import { existsSync } from 'fs';
import { resolve } from 'path';

let envLoaded = false;

export function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }

  if (typeof process.loadEnvFile !== 'function') {
    envLoaded = true;
    return;
  }

  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  envLoaded = true;
}
