import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export type InstallerRunKind =
  | 'setup'
  | 'upgrade'
  | 'migrate'
  | 'restart-web'
  | 'seed';

export type InstallerStatus = {
  repoRoot: string;
  versions: { target: string | null; deployed: string | null };
  envFiles: { root: boolean; api: boolean; web: boolean };
  // When running inside the api-dev container, we typically cannot access host Docker socket.
  docker: { available: boolean | null; note?: string };
  migrations: { enabled: boolean };
  activeRun: { id: string; kind: InstallerRunKind } | null;
};

export type InstallerRunRecord = {
  id: string;
  kind: InstallerRunKind;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  command: string;
  logPath: string;
};

@Injectable()
export class InstallerService {
  // __dirname is .../apps/api/src/installer in dev; go up to monorepo root.
  private readonly repoRoot = path.resolve(__dirname, '../../../../');
  private readonly runsDir = path.join(
    this.repoRoot,
    'developer/installer-runs',
  );

  private activeRun: InstallerRunRecord | null = null;
  private readonly runs = new Map<string, InstallerRunRecord>();

  private async readTextIfExists(p: string): Promise<string | null> {
    try {
      return await fsp.readFile(p, 'utf8');
    } catch {
      return null;
    }
  }

  private async getRootVersion(): Promise<string | null> {
    const raw = await this.readTextIfExists(
      path.join(this.repoRoot, 'package.json'),
    );
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { version?: string };
      return parsed.version ?? null;
    } catch {
      return null;
    }
  }

  private async getLastDeployedVersion(): Promise<string | null> {
    const raw = await this.readTextIfExists(
      path.join(this.repoRoot, 'developer/deployments.yml'),
    );
    if (!raw) return null;
    const matches = [...raw.matchAll(/^\s*version:\s*(.+?)\s*$/gm)].map((m) =>
      String(m[1]).replace(/^['"]|['"]$/g, ''),
    );
    return matches.length ? matches[matches.length - 1] : null;
  }

  private async dockerAvailable(): Promise<boolean> {
    return await new Promise((resolve) => {
      const p = spawn('docker', ['version'], { cwd: this.repoRoot });
      p.on('error', () => resolve(false));
      p.on('exit', (code: number | null) => resolve(code === 0));
    });
  }

  private async detectMigrationsEnabled(): Promise<boolean> {
    const raw = await this.readTextIfExists(
      path.join(this.repoRoot, 'apps/api/package.json'),
    );
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
      return Boolean(parsed.scripts && parsed.scripts['migration:run']);
    } catch {
      return false;
    }
  }

  async status(): Promise<InstallerStatus> {
    const [rootVersion, lastDeployed, dockerOk, migrationsEnabled] =
      await Promise.all([
        this.getRootVersion(),
        this.getLastDeployedVersion(),
        this.dockerAvailable(),
        this.detectMigrationsEnabled(),
      ]);

    const envFiles = {
      root: fs.existsSync(path.join(this.repoRoot, '.env')),
      api: fs.existsSync(path.join(this.repoRoot, 'apps/api/.env')),
      web: fs.existsSync(path.join(this.repoRoot, 'apps/web/.env')),
    };

    return {
      repoRoot: this.repoRoot,
      versions: {
        target: rootVersion,
        deployed: lastDeployed,
      },
      envFiles,
      docker: dockerOk
        ? { available: true }
        : {
            available: null,
            note: 'Running inside container; host Docker may not be accessible (expected in docker:dev:up).',
          },
      migrations: { enabled: migrationsEnabled },
      activeRun: this.activeRun
        ? { id: this.activeRun.id, kind: this.activeRun.kind }
        : null,
    };
  }

  private async ensureRunsDir(): Promise<void> {
    await fsp.mkdir(this.runsDir, { recursive: true });
  }

  listRuns(limit = 25): InstallerRunRecord[] {
    return [...this.runs.values()]
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit);
  }

  getRun(id: string): InstallerRunRecord | null {
    return this.runs.get(id) ?? null;
  }

  async getRunLog(id: string): Promise<string> {
    const rec = this.getRun(id);
    if (!rec) return '';
    try {
      return await fsp.readFile(rec.logPath, 'utf8');
    } catch {
      return '';
    }
  }

  private async startRun(
    kind: InstallerRunKind,
    command: string,
    args: string[],
  ) {
    if (this.activeRun) {
      throw new InternalServerErrorException(
        `Another setup run is active: ${this.activeRun.kind} (${this.activeRun.id})`,
      );
    }

    await this.ensureRunsDir();
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.runsDir, `${id}.log`);

    const record: InstallerRunRecord = {
      id,
      kind,
      startedAt,
      command: [command, ...args].join(' '),
      logPath,
    };
    this.runs.set(id, record);
    this.activeRun = record;

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`[${startedAt}] start ${record.command}\n`);

    const child = spawn(command, args, {
      cwd: this.repoRoot,
      env: process.env,
    });
    child.stdout.on('data', (d: Buffer) => logStream.write(d));
    child.stderr.on('data', (d: Buffer) => logStream.write(d));
    child.on('error', (e: Error) => logStream.write(`\nERROR: ${String(e)}\n`));
    child.on('close', (code: number | null) => {
      record.exitCode = code;
      record.finishedAt = new Date().toISOString();
      logStream.write(`\n[${record.finishedAt}] exit ${String(code)}\n`);
      logStream.end();
      this.activeRun = null;
    });

    return record;
  }

  async setup(): Promise<InstallerRunRecord> {
    return this.startRun('setup', './scripts/setup.sh', []);
  }

  async upgrade(options: {
    env: string;
    remoteSubmodules?: boolean;
    checks?: boolean;
  }): Promise<InstallerRunRecord> {
    const args = ['./scripts/upgrade.sh', '--env', options.env || 'dev'];
    if (options.remoteSubmodules) args.push('--remote-submodules');
    if (options.checks) args.push('--checks');
    return this.startRun('upgrade', args[0], args.slice(1));
  }

  async migrate(): Promise<InstallerRunRecord> {
    const enabled = await this.detectMigrationsEnabled();
    if (!enabled) {
      const id = crypto.randomUUID();
      await this.ensureRunsDir();
      const logPath = path.join(this.runsDir, `${id}.log`);
      const startedAt = new Date().toISOString();
      const record: InstallerRunRecord = {
        id,
        kind: 'migrate',
        startedAt,
        finishedAt: startedAt,
        exitCode: null,
        command: 'migrate (disabled)',
        logPath,
      };
      await fsp.writeFile(
        logPath,
        `[${startedAt}] migrations disabled\nMigrations are not enabled yet (API uses TypeORM synchronize=true). See docs/sops/SOP_MIGRATIONS_SEED.md.\n`,
        'utf8',
      );
      this.runs.set(id, record);
      return record;
    }
    return this.startRun('migrate', 'npm', [
      '--prefix',
      'apps/api',
      'run',
      'migration:run',
    ]);
  }

  async restartWeb(): Promise<InstallerRunRecord> {
    // Use `docker compose restart` so we only restart the web-dev
    // container and do not recreate api-dev (this container).
    return this.startRun('restart-web', 'docker', [
      'compose',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.dev.yml',
      'restart',
      'web-dev',
    ]);
  }

  async seed(): Promise<InstallerRunRecord> {
    return this.startRun('seed', 'npm', [
      '--prefix',
      'apps/api',
      'run',
      'seed:run',
    ]);
  }
}
