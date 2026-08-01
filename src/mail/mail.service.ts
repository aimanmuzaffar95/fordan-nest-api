import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { simpleParser } from 'mailparser';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MailMessage } from './mail-message.entity';
import { Customer } from '../customers/entities/customer.entity';
import { MailOutbox } from './mail-outbox.entity';
import { MailSyncService, sanitizeSignatureHtml } from './mail-sync.service';
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
import { SendMailDto, MailAttachmentInput } from './dto/mail.dto';

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
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    private readonly sync: MailSyncService,
  ) {}

  // -------------------------------------------------------- unified ALL helpers

  /** Virtual folder path for the merged INBOX + Sent view. */
  private static readonly ALL_FOLDER = 'ALL';

  /**
   * Resolve the mailbox's Sent-equivalent folder path from the folder snapshot:
   * prefer specialUse '\\Sent', else any folder whose path/name matches /sent/i.
   * Returns null when none can be determined.
   */
  private resolveSentPath(box: LinkedMailbox): string | null {
    const folders = box.foldersJson ?? [];
    const bySpecial = folders.find((f) => f.specialUse === '\\Sent');
    if (bySpecial) return bySpecial.path;
    const byName = folders.find(
      (f) => /sent/i.test(f.name) || /sent/i.test(f.path),
    );
    return byName?.path ?? null;
  }

  /** The set of real folders unioned by the ALL view (INBOX + Sent-equiv). */
  private allFolderPaths(box: LinkedMailbox): string[] {
    const sent = this.resolveSentPath(box);
    return sent && sent !== 'INBOX' ? ['INBOX', sent] : ['INBOX'];
  }

  /**
   * For a batch of message rows, resolve the counterparty address of each
   * (first `to` for Sent-equivalent folder rows, otherwise fromAddress) and
   * match case-insensitively against customers.email in ONE query. Returns a
   * lowercased-address → { id, name } map. No N+1.
   */
  private async matchCustomers(
    rows: { folder: string; fromAddress: string; toJson: string[] | null }[],
    sentPath: string | null,
  ): Promise<Map<string, { id: string; name: string }>> {
    const addresses = new Set<string>();
    for (const r of rows) {
      const addr = this.counterpartyAddress(r, sentPath);
      if (addr) addresses.add(addr);
    }
    const result = new Map<string, { id: string; name: string }>();
    if (addresses.size === 0) return result;

    const matches = await this.customers
      .createQueryBuilder('c')
      .select(['c.id', 'c.firstName', 'c.lastName', 'c.email'])
      .where('LOWER(c.email) IN (:...emails)', {
        emails: [...addresses],
      })
      .getMany();
    for (const c of matches) {
      result.set(c.email.toLowerCase(), {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
      });
    }
    return result;
  }

  /** Lowercased counterparty address for one row, or '' when unavailable. */
  private counterpartyAddress(
    row: { folder: string; fromAddress: string; toJson: string[] | null },
    sentPath: string | null,
  ): string {
    const isSent = sentPath !== null && row.folder === sentPath;
    const addr = isSent
      ? (row.toJson ?? [])[0] ?? ''
      : row.fromAddress ?? '';
    return addr.toLowerCase();
  }

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
      signatureHtml: box.signatureHtml,
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
      signatureHtml: dto.signatureHtml
        ? sanitizeSignatureHtml(dto.signatureHtml)
        : null,
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
    // undefined = keep; empty string = clear; otherwise sanitize + store.
    if (dto.signatureHtml !== undefined) {
      box.signatureHtml =
        dto.signatureHtml === ''
          ? null
          : sanitizeSignatureHtml(dto.signatureHtml);
    }

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
    const clean = sanitizeSignatureHtml(signatureHtml);
    box.signatureHtml = clean;
    await this.mailboxes.save(box);
    return { ok: true, signatureHtml: clean };
  }

  /**
   * Prepend the virtual "ALL" folder: unseen = sum of unseen across INBOX +
   * the Sent-equivalent folder, derived from the snapshot rows themselves.
   */
  private withAllFolder(
    items: { path: string; name: string; unseen: number }[],
  ): { path: string; name: string; unseen: number }[] {
    const inbox = items.find((f) => f.path === 'INBOX');
    const sent = items.find(
      (f) =>
        f.path !== 'INBOX' && (/sent/i.test(f.name) || /sent/i.test(f.path)),
    );
    const unseen = (inbox?.unseen ?? 0) + (sent?.unseen ?? 0);
    return [{ path: 'ALL', name: 'All mail', unseen }, ...items];
  }

  async listFolders(userId: string) {
    const box = await this.requireMailbox(userId);

    // Served from the folder snapshot stored during the last sync.
    if (box.foldersJson && box.foldersJson.length > 0) {
      return {
        items: this.withAllFolder(
          box.foldersJson.map((f) => ({
            path: f.path,
            name: f.name,
            unseen: f.unseen,
          })),
        ),
      };
    }

    // Never synced yet — best-effort synchronous sync, then re-read.
    await this.sync.syncMailbox(box.id);
    const fresh = await this.mailboxes.findOne({ where: { id: box.id } });
    const folders = fresh?.foldersJson ?? [];
    if (folders.length > 0) {
      return {
        items: this.withAllFolder(
          folders.map((f) => ({
            path: f.path,
            name: f.name,
            unseen: f.unseen,
          })),
        ),
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
    return { items: this.withAllFolder(items) };
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

    // ALL: union of INBOX + the Sent-equivalent folder, ordered by date DESC.
    const isAll = folderPath === MailService.ALL_FOLDER;
    const where = isAll
      ? { mailboxId: box.id, folder: In(this.allFolderPaths(box)) }
      : { mailboxId: box.id, folder: folderPath };

    const [rows, total] = await this.messages.findAndCount({
      where,
      order: { date: 'DESC', uid: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const sentPath = this.resolveSentPath(box);
    const customerByAddr = await this.matchCustomers(rows, sentPath);

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
      folder: m.folder,
      customer:
        customerByAddr.get(this.counterpartyAddress(m, sentPath)) ?? null,
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
    const requested = folder || 'INBOX';
    const isAll = requested === MailService.ALL_FOLDER;

    let row: MailMessage | null = null;
    if (isAll) {
      // Search across INBOX + Sent for this uid; prefer INBOX if ambiguous.
      const paths = this.allFolderPaths(box);
      const candidates = await this.messages.find({
        where: { mailboxId: box.id, folder: In(paths), uid },
      });
      row =
        candidates.find((c) => c.folder === 'INBOX') ?? candidates[0] ?? null;
    } else {
      row = await this.messages.findOne({
        where: { mailboxId: box.id, folder: requested, uid },
      });
    }

    // Real folder to use for any live IMAP work below.
    const folderPath = row?.folder ?? (isAll ? 'INBOX' : requested);

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

    const sentPath = this.resolveSentPath(box);
    const customerByAddr = await this.matchCustomers([row], sentPath);
    const customer =
      customerByAddr.get(this.counterpartyAddress(row, sentPath)) ?? null;

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
      attachments: (row.attachmentsJson ?? []).map((a, index) => ({
        ...a,
        index,
      })),
      folder: row.folder,
      customer,
      ...(bodyPending ? { bodyPending: true } : {}),
    };
  }

  /** Cap on a single attachment's decoded size streamed back to the client. */
  private static readonly MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

  /**
   * Download a single attachment by its index in the parsed attachments array.
   * Re-fetches the raw message source from IMAP (one fetchOne, like the detail
   * live-fetch), parses it, and returns the raw content buffer + headers.
   */
  async getAttachment(
    userId: string,
    uid: number,
    index: number,
    folder: string,
  ): Promise<{
    buffer: Buffer;
    contentType: string;
    filename: string;
    disposition: 'inline' | 'attachment';
  }> {
    const box = await this.requireMailbox(userId);
    const requested = folder || 'INBOX';
    const isAll = requested === MailService.ALL_FOLDER;

    // Resolve the real folder holding this uid, mirroring getMessage/markRead.
    let folderPath = isAll ? 'INBOX' : requested;
    if (isAll) {
      const paths = this.allFolderPaths(box);
      const candidates = await this.messages.find({
        where: { mailboxId: box.id, folder: In(paths), uid },
      });
      const row =
        candidates.find((c) => c.folder === 'INBOX') ?? candidates[0] ?? null;
      if (row) folderPath = row.folder;
    }

    let source: Buffer | null;
    try {
      source = await this.withImapRaw(box, async (client) => {
        const lock = await client.getMailboxLock(folderPath);
        try {
          const msg = await client.fetchOne(
            String(uid),
            { uid: true, source: true },
            { uid: true },
          );
          return msg && msg.source ? msg.source : null;
        } finally {
          lock.release();
        }
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Attachment fetch failed for ${box.emailAddress} ${folderPath}/${uid}: ${detail}`,
      );
      throw new BadGatewayException({
        message: 'Could not connect to the mail server.',
        code: 'MAILBOX_CONNECT_FAILED',
      });
    }

    if (!source) {
      throw new NotFoundException('Message not found in this folder.');
    }

    const parsed = await simpleParser(source);
    const attachments = parsed.attachments ?? [];
    const attachment = attachments[index];
    if (!attachment || !attachment.content) {
      throw new NotFoundException('Attachment not found.');
    }

    const buffer = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content);
    if (buffer.length > MailService.MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(
        'Attachment exceeds the 25MB download limit.',
      );
    }

    const contentType = attachment.contentType || 'application/octet-stream';
    const filename = this.sanitizeAttachmentFilename(attachment.filename);
    const disposition =
      contentType.startsWith('image/') || contentType === 'application/pdf'
        ? 'inline'
        : 'attachment';

    return { buffer, contentType, filename, disposition };
  }

  /** Strip quotes/newlines from a filename so it is safe in a header value. */
  private sanitizeAttachmentFilename(name: string | undefined): string {
    const clean = (name ?? '').replace(/[\r\n"\\]/g, '').trim();
    return clean || 'attachment';
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
    const requested = folder || 'INBOX';

    let row: MailMessage | null = null;
    if (requested === MailService.ALL_FOLDER) {
      // Resolve the real folder by searching INBOX + Sent; prefer INBOX.
      const candidates = await this.messages.find({
        where: { mailboxId: box.id, folder: In(this.allFolderPaths(box)), uid },
      });
      row =
        candidates.find((c) => c.folder === 'INBOX') ?? candidates[0] ?? null;
    } else {
      row = await this.messages.findOne({
        where: { mailboxId: box.id, folder: requested, uid },
      });
    }

    const folderPath = row?.folder ?? (requested === MailService.ALL_FOLDER ? 'INBOX' : requested);
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
  /** Combined decoded cap on outbound attachments. */
  private static readonly MAX_OUTBOUND_ATTACHMENTS_BYTES = 15 * 1024 * 1024;

  /**
   * Decoded byte size of a base64 string (accounting for '=' padding), without
   * allocating the buffer. base64 encodes 3 bytes per 4 chars.
   */
  private decodedBase64Size(b64: string): number {
    const len = b64.length;
    if (len === 0) return 0;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((len * 3) / 4) - padding;
  }

  async send(userId: string, dto: SendMailDto) {
    const box = await this.requireMailbox(userId);

    const attachments =
      dto.attachments && dto.attachments.length > 0 ? dto.attachments : null;
    if (attachments) {
      const total = attachments.reduce(
        (sum, a) => sum + this.decodedBase64Size(a.contentBase64),
        0,
      );
      if (total > MailService.MAX_OUTBOUND_ATTACHMENTS_BYTES) {
        throw new BadRequestException(
          'Attachments exceed the 15MB combined size limit.',
        );
      }
    }

    const row = this.outbox.create({
      mailboxId: box.id,
      userId,
      toJson: dto.to,
      ccJson: dto.cc && dto.cc.length > 0 ? dto.cc : null,
      subject: dto.subject,
      bodyHtml: dto.bodyHtml,
      appendSignature: dto.appendSignature !== false,
      attachmentsJson: attachments,
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
    const rowAttachments =
      row.attachmentsJson && row.attachmentsJson.length > 0
        ? row.attachmentsJson
        : null;
    const mail = {
      from: { name: '', address: box.emailAddress },
      to: row.toJson,
      cc,
      subject: row.subject,
      html,
      ...(rowAttachments
        ? {
            attachments: rowAttachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.contentBase64, 'base64'),
              contentType: a.contentType,
            })),
          }
        : {}),
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
        attachments: rowAttachments
          ? rowAttachments.map((a) => ({
              filename: a.filename,
              size: this.decodedBase64Size(a.contentBase64),
              contentType: a.contentType,
            }))
          : undefined,
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
    msg: {
      subject: string;
      to: string[];
      cc?: string[];
      attachments?: { filename: string; size: number; contentType: string }[];
    },
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
      hasAttachments: (msg.attachments?.length ?? 0) > 0,
      snippet: '',
      attachmentsJson: msg.attachments ?? null,
      syncedAt: new Date(),
    });
    const saved = await this.messages.save(row);
    // storeParsedBody re-derives attachmentsJson from the raw source; re-assert
    // hasAttachments afterwards since it doesn't touch that flag.
    await this.sync.storeParsedBody(saved, raw);
    if ((msg.attachments?.length ?? 0) > 0 && !saved.hasAttachments) {
      saved.hasAttachments = true;
      await this.messages.save(saved);
    }
  }
}
