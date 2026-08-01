import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailMessage } from './mail-message.entity';
import { MailOutbox } from './mail-outbox.entity';
import { MailSyncService } from './mail-sync.service';
import { ImapFlow } from 'imapflow';
import * as nodemailer from 'nodemailer';
import MailComposer = require('nodemailer/lib/mail-composer');
import {
  decryptSettingsValue,
  encryptSettingsValue,
} from '../common/crypto.util';
import { User } from '../users/entities/user.entity';
import { LinkedMailbox } from './linked-mailbox.entity';
import { CreateMailboxDto, UpdateMailboxDto } from './dto/mailbox.dto';
import { SendMailDto } from './dto/mail.dto';

/** Connection/greeting/socket timeout for per-request IMAP sessions. */
const IMAP_TIMEOUT_MS = 10_000;

/** Backoff for the Nth attempt: min(30s * 2^attempts, 1h). */
export function computeOutboxBackoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** attempts, 3_600_000);
}

/** Outcome of one delivery attempt. `permanent` distinguishes fail-fast. */
export interface DeliveryResult {
  ok: boolean;
  permanent?: boolean;
  error?: string;
}

interface EnvelopeAddress {
  name?: string;
  address?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectRepository(LinkedMailbox)
    private readonly mailboxes: Repository<LinkedMailbox>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(MailMessage)
    private readonly messages: Repository<MailMessage>,
    @InjectRepository(MailOutbox)
    private readonly outbox: Repository<MailOutbox>,
    private readonly sync: MailSyncService,
  ) {}

  // ---------------------------------------------------------------- admin CRUD

  private toAdminView(box: LinkedMailbox, userName: string) {
    return {
      id: box.id,
      userId: box.userId,
      userName,
      emailAddress: box.emailAddress,
      imapHost: box.imapHost,
      imapPort: box.imapPort,
      smtpHost: box.smtpHost,
      smtpPort: box.smtpPort,
      active: box.active,
      createdAt: box.createdAt,
    };
  }

  private async userNameFor(userId: string): Promise<string> {
    const user = await this.users.findOne({ where: { id: userId } });
    return user ? `${user.firstName} ${user.lastName}`.trim() : '';
  }

  async listMailboxes() {
    const rows = await this.mailboxes.find({ order: { createdAt: 'ASC' } });
    const items = await Promise.all(
      rows.map(async (box) =>
        this.toAdminView(box, await this.userNameFor(box.userId)),
      ),
    );
    return { items };
  }

  async createMailbox(dto: CreateMailboxDto) {
    const user = await this.users.findOne({ where: { id: dto.userId } });
    if (!user) {
      throw new BadRequestException('No user exists with the given userId.');
    }
    const existing = await this.mailboxes.findOne({
      where: { userId: dto.userId },
    });
    if (existing) {
      throw new BadRequestException(
        'This user already has a linked mailbox. Edit or delete it instead.',
      );
    }

    const box = this.mailboxes.create({
      userId: dto.userId,
      emailAddress: dto.emailAddress,
      username: dto.username?.trim() || dto.emailAddress,
      passwordEncrypted: encryptSettingsValue(dto.password),
      imapHost: dto.imapHost,
      imapPort: dto.imapPort ?? 993,
      imapSecure: dto.imapSecure ?? true,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort ?? 465,
      smtpSecure: dto.smtpSecure ?? true,
      signatureHtml: null,
      active: true,
    });
    const saved = await this.mailboxes.save(box);
    // Kick off an initial background sync so mail is ready on first open.
    this.sync.syncMailbox(saved.id).catch(() => undefined);
    return this.toAdminView(saved, await this.userNameFor(saved.userId));
  }

  async updateMailbox(id: string, dto: UpdateMailboxDto) {
    const box = await this.mailboxes.findOne({ where: { id } });
    if (!box) {
      throw new NotFoundException('Mailbox not found.');
    }

    if (dto.userId !== undefined && dto.userId !== box.userId) {
      const user = await this.users.findOne({ where: { id: dto.userId } });
      if (!user) {
        throw new BadRequestException('No user exists with the given userId.');
      }
      const clash = await this.mailboxes.findOne({
        where: { userId: dto.userId },
      });
      if (clash && clash.id !== id) {
        throw new BadRequestException(
          'The target user already has a linked mailbox.',
        );
      }
      box.userId = dto.userId;
    }

    if (dto.emailAddress !== undefined) box.emailAddress = dto.emailAddress;
    // Blank username resets to the email address — previously a bad username
    // (e.g. a display name pasted by mistake) was impossible to clear from the
    // UI and caused permanent 535 auth failures.
    if (dto.username !== undefined) {
      box.username = dto.username.trim() || box.emailAddress;
    }
    if (dto.password !== undefined && dto.password !== '') {
      box.passwordEncrypted = encryptSettingsValue(dto.password);
      box.lastSyncError = null;
    }
    if (dto.imapHost !== undefined && dto.imapHost !== box.imapHost) {
      box.lastSyncError = null;
    }
    if (dto.smtpHost !== undefined && dto.smtpHost !== box.smtpHost) {
      box.lastSyncError = null;
    }
    if (dto.imapHost !== undefined) box.imapHost = dto.imapHost;
    if (dto.imapPort !== undefined) box.imapPort = dto.imapPort;
    if (dto.imapSecure !== undefined) box.imapSecure = dto.imapSecure;
    if (dto.smtpHost !== undefined) box.smtpHost = dto.smtpHost;
    if (dto.smtpPort !== undefined) box.smtpPort = dto.smtpPort;
    if (dto.smtpSecure !== undefined) box.smtpSecure = dto.smtpSecure;
    if (dto.active !== undefined) box.active = dto.active;

    const saved = await this.mailboxes.save(box);
    return this.toAdminView(saved, await this.userNameFor(saved.userId));
  }

  async deleteMailbox(id: string) {
    const box = await this.mailboxes.findOne({ where: { id } });
    if (!box) {
      throw new NotFoundException('Mailbox not found.');
    }
    await this.mailboxes.delete({ id });
    return { ok: true };
  }

  async testMailbox(id: string) {
    const box = await this.mailboxes.findOne({ where: { id } });
    if (!box) {
      throw new NotFoundException('Mailbox not found.');
    }
    const password = decryptSettingsValue(box.passwordEncrypted);

    let imapOk = false;
    let imapError: string | undefined;
    try {
      const client = this.buildImapClient(box, password);
      await client.connect();
      try {
        await client.logout();
      } catch {
        // ignore logout failures — login already succeeded
      }
      imapOk = true;
    } catch (error: unknown) {
      imapError = error instanceof Error ? error.message : String(error);
    }

    let smtpOk = false;
    let smtpError: string | undefined;
    try {
      const transporter = this.buildSmtpTransport(box, password);
      await transporter.verify();
      smtpOk = true;
    } catch (error: unknown) {
      smtpError = error instanceof Error ? error.message : String(error);
    }

    return {
      imapOk,
      smtpOk,
      ...(imapError !== undefined ? { imapError } : {}),
      ...(smtpError !== undefined ? { smtpError } : {}),
    };
  }

  // ---------------------------------------------------------------- self-serve

  private async requireMailbox(userId: string): Promise<LinkedMailbox> {
    const box = await this.mailboxes.findOne({
      where: { userId, active: true },
    });
    if (!box) {
      throw new NotFoundException({
        message:
          'No mailbox is linked to your account. Ask an administrator to link one under Settings → Mailboxes.',
        code: 'NO_MAILBOX',
      });
    }
    return box;
  }

  async getMyMailbox(userId: string) {
    const box = await this.requireMailbox(userId);
    return {
      emailAddress: box.emailAddress,
      signatureHtml: box.signatureHtml,
      active: box.active,
      lastSyncedAt: box.lastSyncedAt
        ? new Date(box.lastSyncedAt).toISOString()
        : null,
      lastSyncError: box.lastSyncError ?? null,
    };
  }

  async updateSignature(userId: string, signatureHtml: string) {
    const box = await this.requireMailbox(userId);
    box.signatureHtml = signatureHtml;
    await this.mailboxes.save(box);
    return { ok: true };
  }

  async listFolders(userId: string) {
    const box = await this.requireMailbox(userId);

    // Served from the folder snapshot stored during the last sync.
    if (box.foldersJson && box.foldersJson.length > 0) {
      return {
        items: box.foldersJson.map((f) => ({
          path: f.path,
          name: f.name,
          unseen: f.unseen,
        })),
      };
    }

    // Never synced yet — best-effort synchronous sync, then re-read.
    await this.sync.syncMailbox(box.id);
    const fresh = await this.mailboxes.findOne({ where: { id: box.id } });
    const folders = fresh?.foldersJson ?? [];
    if (folders.length > 0) {
      return {
        items: folders.map((f) => ({
          path: f.path,
          name: f.name,
          unseen: f.unseen,
        })),
      };
    }

    // Sync failed too — derive from whatever messages we have stored.
    const rows: { folder: string; unseen: string }[] = await this.messages
      .createQueryBuilder('m')
      .select('m.folder', 'folder')
      .addSelect('SUM(CASE WHEN m.seen = false THEN 1 ELSE 0 END)', 'unseen')
      .where('m.mailboxId = :id', { id: box.id })
      .groupBy('m.folder')
      .getRawMany();
    const items = rows.map((r) => ({
      path: r.folder,
      name: r.folder.split('/').pop() ?? r.folder,
      unseen: Number(r.unseen) || 0,
    }));
    if (items.length === 0) {
      items.push({ path: 'INBOX', name: 'INBOX', unseen: 0 });
    }
    return { items };
  }

  async listMessages(
    userId: string,
    folder: string,
    page: number,
    limit: number,
  ) {
    const box = await this.requireMailbox(userId);
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 && limit <= 100
        ? Math.floor(limit)
        : 25;

    const folderPath = folder || 'INBOX';

    // First-ever read for this mailbox: best-effort synchronous sync so the
    // user doesn't see an empty inbox. Failures are tolerated — we serve
    // whatever the DB has.
    const anyRow = await this.messages.findOne({
      where: { mailboxId: box.id },
    });
    if (!anyRow) {
      await this.sync.syncMailbox(box.id);
    }

    const [rows, total] = await this.messages.findAndCount({
      where: { mailboxId: box.id, folder: folderPath },
      order: { date: 'DESC', uid: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const items = rows.map((m) => ({
      uid: m.uid,
      subject: m.subject,
      fromName: m.fromName,
      fromAddress: m.fromAddress,
      to: m.toJson ?? [],
      date: m.date ?? null,
      seen: m.seen,
      hasAttachments: m.hasAttachments,
      snippet: m.snippet ?? '',
    }));

    const fresh = await this.mailboxes.findOne({ where: { id: box.id } });
    const syncedAt = fresh?.lastSyncedAt
      ? new Date(fresh.lastSyncedAt).toISOString()
      : null;
    const stale =
      !syncedAt || Date.now() - new Date(syncedAt).getTime() > 10 * 60_000;

    return { items, total, page: safePage, limit: safeLimit, syncedAt, stale };
  }

  async getMessage(userId: string, uid: number, folder: string) {
    const box = await this.requireMailbox(userId);
    const folderPath = folder || 'INBOX';

    let row = await this.messages.findOne({
      where: { mailboxId: box.id, folder: folderPath, uid },
    });

    // Not synced yet at all — fall back to a single live fetch and store it.
    if (!row) {
      row = await this.liveFetchIntoDb(box, folderPath, uid);
      if (!row) {
        throw new NotFoundException('Message not found in this folder.');
      }
    }

    // Summary row without a body — attempt one live body fetch.
    let bodyPending = false;
    if (row.bodyText === null && row.bodyHtml === null) {
      const fetched = await this.liveFetchIntoDb(box, folderPath, uid, row);
      if (fetched) {
        row = fetched;
      } else {
        bodyPending = true;
      }
    }

    // Opening a message marks it read: DB immediately, IMAP best-effort.
    if (!row.seen) {
      row.seen = true;
      await this.messages.save(row);
      this.flagSeenBestEffort(box, folderPath, uid);
    }

    return {
      uid,
      subject: row.subject,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      to: row.toJson ?? [],
      cc: row.ccJson ?? [],
      date: row.date ?? null,
      seen: true,
      bodyHtml: row.bodyHtml ?? '',
      bodyText: row.bodyText ?? '',
      attachments: row.attachmentsJson ?? [],
      ...(bodyPending ? { bodyPending: true } : {}),
    };
  }

  /**
   * Single live IMAP fetch of one message; parses, sanitizes and stores it.
   * Returns null on any failure — callers degrade gracefully.
   */
  private async liveFetchIntoDb(
    box: LinkedMailbox,
    folderPath: string,
    uid: number,
    existing?: MailMessage,
  ): Promise<MailMessage | null> {
    try {
      return await this.withImapRaw(box, async (client) => {
        const lock = await client.getMailboxLock(folderPath);
        try {
          const msg = await client.fetchOne(
            String(uid),
            { uid: true, source: true, envelope: true, flags: true },
            { uid: true },
          );
          if (!msg || !msg.source) return null;

          let row = existing;
          if (!row) {
            const from = (msg.envelope?.from?.[0] ?? {}) as EnvelopeAddress;
            const to = (msg.envelope?.to ?? []) as EnvelopeAddress[];
            const cc = (msg.envelope?.cc ?? []) as EnvelopeAddress[];
            row = this.messages.create({
              mailboxId: box.id,
              folder: folderPath,
              uid,
              subject: msg.envelope?.subject ?? '',
              fromName: (from.name ?? '').slice(0, 255),
              fromAddress: (from.address ?? '').slice(0, 320),
              toJson: to.map((a) => a.address ?? '').filter((a) => a !== ''),
              ccJson: cc.map((a) => a.address ?? '').filter((a) => a !== ''),
              date: msg.envelope?.date ?? null,
              seen: msg.flags?.has('\\Seen') ?? false,
              hasAttachments: false,
              snippet: '',
              syncedAt: new Date(),
            });
            row = await this.messages.save(row);
          }
          await this.sync.storeParsedBody(row, msg.source);
          row.hasAttachments =
            (row.attachmentsJson?.length ?? 0) > 0 ? true : row.hasAttachments;
          await this.messages.save(row);
          return row;
        } finally {
          lock.release();
        }
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Live body fetch failed for ${box.emailAddress} ${folderPath}/${uid}: ${detail}`,
      );
      return null;
    }
  }

  /** Fire-and-forget \Seen flag on the IMAP server. */
  private flagSeenBestEffort(
    box: LinkedMailbox,
    folderPath: string,
    uid: number,
  ): void {
    void this.withImapRaw(box, async (client) => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } finally {
        lock.release();
      }
    }).catch(() => undefined);
  }

  async markRead(userId: string, uid: number, folder: string) {
    const box = await this.requireMailbox(userId);
    const folderPath = folder || 'INBOX';
    const row = await this.messages.findOne({
      where: { mailboxId: box.id, folder: folderPath, uid },
    });
    if (row && !row.seen) {
      row.seen = true;
      await this.messages.save(row);
    }
    this.flagSeenBestEffort(box, folderPath, uid);
    return { ok: true };
  }

  /** On-demand sync for the caller's mailbox (30s rate limit). */
  async refresh(userId: string) {
    const box = await this.requireMailbox(userId);
    if (
      box.lastSyncedAt &&
      Date.now() - new Date(box.lastSyncedAt).getTime() < 30_000
    ) {
      return {
        ok: true,
        syncedAt: new Date(box.lastSyncedAt).toISOString(),
      };
    }
    await this.sync.syncMailbox(box.id);
    const fresh = await this.mailboxes.findOne({ where: { id: box.id } });
    return {
      ok: !fresh?.lastSyncError,
      syncedAt: fresh?.lastSyncedAt
        ? new Date(fresh.lastSyncedAt).toISOString()
        : null,
    };
  }

  /**
   * Enqueue a message and attempt one immediate delivery. Never throws on a
   * delivery failure — a transient failure leaves the row queued for the
   * worker, a permanent one marks it failed. Validation (empty recipients etc.)
   * is enforced by the DTO before this runs.
   */
  async send(userId: string, dto: SendMailDto) {
    const box = await this.requireMailbox(userId);

    const row = this.outbox.create({
      mailboxId: box.id,
      userId,
      toJson: dto.to,
      ccJson: dto.cc && dto.cc.length > 0 ? dto.cc : null,
      subject: dto.subject,
      bodyHtml: dto.bodyHtml,
      appendSignature: dto.appendSignature !== false,
      inReplyToUid: null,
      status: 'queued',
      attempts: 0,
      maxAttempts: 6,
      lastError: null,
      nextAttemptAt: new Date(),
      sentAt: null,
    });
    const saved = await this.outbox.save(row);

    const result = await this.deliverOutboxRow(saved);
    await this.applyDeliveryResult(saved, result);

    return {
      ok: true,
      queued: saved.status !== 'sent',
      outboxId: saved.id,
    };
  }

  /**
   * Persist the effect of a delivery attempt onto an outbox row.
   * - success           → sent, sentAt set
   * - permanent failure → failed (fail fast, no retries)
   * - transient failure → queued, attempts++, backoff scheduled unless the
   *                        attempt cap is reached (then failed)
   */
  async applyDeliveryResult(
    row: MailOutbox,
    result: DeliveryResult,
  ): Promise<void> {
    if (result.ok) {
      row.status = 'sent';
      row.sentAt = new Date();
      row.lastError = null;
      row.nextAttemptAt = null;
      await this.outbox.save(row);
      return;
    }

    row.attempts += 1;
    row.lastError = (result.error ?? 'Delivery failed').slice(0, 500);

    if (result.permanent || row.attempts >= row.maxAttempts) {
      row.status = 'failed';
      row.nextAttemptAt = null;
    } else {
      row.status = 'queued';
      row.nextAttemptAt = new Date(
        Date.now() + computeOutboxBackoffMs(row.attempts),
      );
    }
    await this.outbox.save(row);
  }

  /**
   * Reusable delivery core shared by the immediate send path and the worker.
   * Composes RFC822, sends over SMTP, and on success best-effort appends to the
   * Sent folder + mirrors into the local store. Never throws — returns a
   * classified result instead.
   */
  async deliverOutboxRow(row: MailOutbox): Promise<DeliveryResult> {
    const box = await this.mailboxes.findOne({ where: { id: row.mailboxId } });
    if (!box || !box.active) {
      return {
        ok: false,
        permanent: true,
        error: 'Linked mailbox not found or inactive.',
      };
    }
    const password = decryptSettingsValue(box.passwordEncrypted);

    let html = row.bodyHtml;
    if (row.appendSignature && box.signatureHtml) {
      html = `${html}<br/><br/>${box.signatureHtml}`;
    }

    const cc = row.ccJson && row.ccJson.length > 0 ? row.ccJson : undefined;
    const mail = {
      from: { name: '', address: box.emailAddress },
      to: row.toJson,
      cc,
      subject: row.subject,
      html,
    };

    // Compose the raw RFC822 message once so the exact bytes we send are what
    // we append to the Sent folder afterwards.
    const raw: Buffer = await new MailComposer(mail)
      .compile()
      .build()
      .then((buf) => buf);

    const transporter = this.buildSmtpTransport(box, password);
    try {
      await transporter.sendMail({
        envelope: {
          from: box.emailAddress,
          to: [...row.toJson, ...(row.ccJson ?? [])],
        },
        raw,
      });
    } catch (error: unknown) {
      const { permanent, detail } = this.classifySmtpError(error);
      this.logger.error(
        `SMTP send ${permanent ? '(permanent)' : '(transient)'} failed for ` +
          `mailbox ${box.emailAddress}: ${detail}`,
      );
      return { ok: false, permanent, error: detail };
    }

    // Best-effort copy into the Sent folder — never fail delivery over it.
    try {
      await this.appendToSent(box, password, raw);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not append sent copy for ${box.emailAddress}: ${detail}`,
      );
    }

    // Mirror into the local store so the message is visible immediately.
    try {
      await this.storeSentLocally(box, raw, {
        subject: row.subject,
        to: row.toJson,
        cc: row.ccJson ?? undefined,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not store local sent copy for ${box.emailAddress}: ${detail}`,
      );
    }

    return { ok: true };
  }

  /**
   * Classify an SMTP send error as permanent (bad credentials / 5xx policy
   * rejection — retrying is pointless) vs transient (network, timeout,
   * connection reset — worth retrying with backoff).
   */
  private classifySmtpError(error: unknown): {
    permanent: boolean;
    detail: string;
  } {
    const err = error as {
      responseCode?: number;
      code?: string;
      message?: string;
    };
    const detail = (
      err?.message ?? (error instanceof Error ? error.message : String(error))
    ).slice(0, 500);
    const responseCode =
      typeof err?.responseCode === 'number' ? err.responseCode : undefined;
    const code = typeof err?.code === 'string' ? err.code : undefined;
    // Permanent: an SMTP 5xx reply (bad recipient / policy / mailbox) or an
    // explicit authentication failure (nodemailer code 'EAUTH', 535 login).
    const permanent =
      (responseCode !== undefined && responseCode >= 500 && responseCode < 600) ||
      code === 'EAUTH';
    return { permanent, detail };
  }

  // ------------------------------------------------------------------- outbox

  private outboxView(row: MailOutbox) {
    return {
      id: row.id,
      to: row.toJson ?? [],
      cc: row.ccJson ?? [],
      subject: row.subject,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt,
      nextAttemptAt: row.nextAttemptAt,
      sentAt: row.sentAt,
    };
  }

  /** Active queue + recently-sent rows for the caller's own mailbox. */
  async listOutbox(userId: string) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const rows = await this.outbox.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const items = rows
      .filter(
        (r) =>
          r.status !== 'sent' ||
          (r.sentAt !== null && r.sentAt >= fiveMinAgo),
      )
      .map((r) => this.outboxView(r));
    return { items };
  }

  private async requireOwnedOutboxRow(
    userId: string,
    id: string,
  ): Promise<MailOutbox> {
    const row = await this.outbox.findOne({ where: { id } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Outbox message not found.');
    }
    return row;
  }

  /** Requeue a failed/queued row for another delivery attempt now. */
  async retryOutbox(userId: string, id: string) {
    const row = await this.requireOwnedOutboxRow(userId, id);
    if (row.status === 'sent') {
      throw new BadRequestException('This message was already sent.');
    }
    row.status = 'queued';
    row.nextAttemptAt = new Date();
    await this.outbox.save(row);
    // Kick the worker so the retry is picked up promptly.
    this.worker?.kick();
    return { ok: true, status: row.status };
  }

  /** Cancel a queued/failed row (never one already sent). */
  async deleteOutbox(userId: string, id: string) {
    const row = await this.requireOwnedOutboxRow(userId, id);
    if (row.status === 'sent') {
      throw new BadRequestException(
        'This message was already sent and cannot be cancelled.',
      );
    }
    await this.outbox.delete({ id: row.id });
    return { ok: true };
  }

  /**
   * Wired up by MailOutboxService on init to avoid a circular constructor
   * dependency; lets retry kick a delivery run immediately.
   */
  private worker?: { kick: () => void };
  registerWorker(worker: { kick: () => void }): void {
    this.worker = worker;
  }

  // ------------------------------------------------------------------ plumbing

  private buildImapClient(box: LinkedMailbox, password: string): ImapFlow {
    return new ImapFlow({
      host: box.imapHost,
      port: box.imapPort,
      secure: box.imapSecure,
      auth: { user: box.username, pass: password },
      logger: false,
      connectionTimeout: IMAP_TIMEOUT_MS,
      greetingTimeout: IMAP_TIMEOUT_MS,
      socketTimeout: IMAP_TIMEOUT_MS * 3,
    });
  }

  private buildSmtpTransport(box: LinkedMailbox, password: string) {
    return nodemailer.createTransport({
      host: box.smtpHost,
      port: box.smtpPort,
      secure: box.smtpSecure,
      auth: { user: box.username, pass: password },
      connectionTimeout: IMAP_TIMEOUT_MS,
      greetingTimeout: IMAP_TIMEOUT_MS,
      socketTimeout: IMAP_TIMEOUT_MS * 3,
    });
  }

  /** Like withImap but propagates raw errors — for best-effort internal work. */
  private async withImapRaw<T>(
    box: LinkedMailbox,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = this.buildImapClient(
      box,
      decryptSettingsValue(box.passwordEncrypted),
    );
    await client.connect();
    try {
      return await fn(client);
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }

  private async appendToSent(
    box: LinkedMailbox,
    password: string,
    raw: Buffer,
  ): Promise<void> {
    const client = this.buildImapClient(box, password);
    await client.connect();
    try {
      let sentPath = 'Sent';
      try {
        const folders = await client.list();
        const bySpecialUse = folders.find((f) => f.specialUse === '\\Sent');
        const byName = folders.find((f) => /sent/i.test(f.name));
        sentPath = bySpecialUse?.path ?? byName?.path ?? 'Sent';
      } catch {
        // fall back to "Sent"
      }
      await client.append(sentPath, raw, ['\\Seen']);
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }

  /**
   * Insert the just-sent message into mail_messages under the Sent folder with
   * a synthetic negative uid (the server assigns the real UID; the next sync
   * inserts the real row and prunes synthetic ones).
   */
  private async storeSentLocally(
    box: LinkedMailbox,
    raw: Buffer,
    msg: { subject: string; to: string[]; cc?: string[] },
  ): Promise<void> {
    const folders = box.foldersJson ?? [];
    const sentPath =
      folders.find((f) => f.specialUse === '\\Sent')?.path ??
      folders.find((f) => /sent/i.test(f.name))?.path ??
      'Sent';

    const row = this.messages.create({
      mailboxId: box.id,
      folder: sentPath,
      // Negative synthetic uid — unique per (mailbox, folder), pruned on sync.
      uid: -Math.floor(Date.now() / 1000),
      subject: msg.subject,
      fromName: '',
      fromAddress: box.emailAddress,
      toJson: msg.to,
      ccJson: msg.cc ?? [],
      date: new Date(),
      seen: true,
      hasAttachments: false,
      snippet: '',
      syncedAt: new Date(),
    });
    const saved = await this.messages.save(row);
    await this.sync.storeParsedBody(saved, raw);
  }
}
