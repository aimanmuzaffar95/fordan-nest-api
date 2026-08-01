import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailMessage } from './mail-message.entity';
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

  async send(userId: string, dto: SendMailDto) {
    const box = await this.requireMailbox(userId);
    const password = decryptSettingsValue(box.passwordEncrypted);

    let html = dto.bodyHtml;
    if (dto.appendSignature !== false && box.signatureHtml) {
      html = `${html}<br/><br/>${box.signatureHtml}`;
    }

    const mail = {
      from: { name: '', address: box.emailAddress },
      to: dto.to,
      cc: dto.cc && dto.cc.length > 0 ? dto.cc : undefined,
      subject: dto.subject,
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
          to: [...dto.to, ...(dto.cc ?? [])],
        },
        raw,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `SMTP send failed for mailbox ${box.emailAddress}: ${detail}`,
      );
      throw new BadGatewayException({
        message:
          'Could not send the email — the mail server rejected the connection or login. Check the mailbox settings or try again shortly.',
        code: 'MAILBOX_CONNECT_FAILED',
      });
    }

    // Best-effort copy into the Sent folder — never fail the request over it.
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
      await this.storeSentLocally(box, raw, dto);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not store local sent copy for ${box.emailAddress}: ${detail}`,
      );
    }

    return { ok: true };
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
    dto: SendMailDto,
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
      subject: dto.subject,
      fromName: '',
      fromAddress: box.emailAddress,
      toJson: dto.to,
      ccJson: dto.cc ?? [],
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
