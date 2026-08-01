import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MailOutbox } from './mail-outbox.entity';
import { MailService } from './mail.service';

/** How often the worker scans for due rows. */
const WORKER_INTERVAL_MS = 30_000;
/** Rows delivered per scan — small, one SMTP connection at a time. */
const BATCH_SIZE = 5;

/**
 * Background delivery worker for mail_outbox. Mirrors MailSyncService's
 * serialized-interval-worker pattern: a single unref'd setInterval, an
 * in-process promise queue so runs never overlap (never parallel SMTP), and the
 * MAIL_SYNC_DISABLED kill-switch. @nestjs/schedule is intentionally not used.
 */
@Injectable()
export class MailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailOutboxService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Serializes all delivery work (interval + manual kicks) — never parallel. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(MailOutbox)
    private readonly outbox: Repository<MailOutbox>,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    // Let the service kick a delivery run right after a retry.
    this.mail.registerWorker({ kick: () => this.kick() });
    if (process.env.MAIL_SYNC_DISABLED === 'true') return;
    this.timer = setInterval(() => {
      this.kick();
    }, WORKER_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Enqueue a delivery pass so runs never overlap. */
  kick(): void {
    this.queue = this.queue
      .then(() => this.runOnce())
      .catch((err: unknown) => {
        this.logger.error('Outbox delivery pass failed', err as Error);
      });
  }

  /** Deliver a small batch of due rows, oldest first. */
  private async runOnce(): Promise<void> {
    const now = new Date();
    // Reclaim rows stranded in 'sending' by a mid-delivery crash/restart
    // (updatedAt older than 5 min) so they aren't stuck forever.
    const stuckCutoff = new Date(now.getTime() - 5 * 60 * 1000);
    await this.outbox
      .createQueryBuilder()
      .update()
      .set({ status: 'queued' })
      .where('status = :s AND updatedAt <= :cut', {
        s: 'sending',
        cut: stuckCutoff,
      })
      .execute();

    const due = await this.outbox.find({
      where: { status: 'queued', nextAttemptAt: LessThanOrEqual(now) },
      order: { nextAttemptAt: 'ASC', createdAt: 'ASC' },
      take: BATCH_SIZE,
    });

    for (const row of due) {
      // Claim the row so a concurrent kick can't re-pick it.
      row.status = 'sending';
      await this.outbox.save(row);

      const result = await this.mail.deliverOutboxRow(row);
      await this.mail.applyDeliveryResult(row, result);
    }
  }
}
