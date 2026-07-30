import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
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
    if (dto.username !== undefined && dto.username.trim() !== '') {
      box.username = dto.username.trim();
    }
    if (dto.password !== undefined && dto.password !== '') {
      box.passwordEncrypted = encryptSettingsValue(dto.password);
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
    return this.withImap(box, async (client) => {
      const folders = await client.list();
      const items: { path: string; name: string; unseen: number }[] = [];
      for (const folder of folders) {
        if (folder.flags?.has('\\Noselect')) continue;
        let unseen = 0;
        try {
          const status = await client.status(folder.path, { unseen: true });
          unseen = status.unseen ?? 0;
        } catch {
          // some servers refuse STATUS on certain folders — report 0
        }
        items.push({ path: folder.path, name: folder.name, unseen });
      }
      return { items };
    });
  }

  async listMessages(userId: string, folder: string, page: number, limit: number) {
    const box = await this.requireMailbox(userId);
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 && limit <= 100
        ? Math.floor(limit)
        : 25;

    return this.withImap(box, async (client) => {
      const lock = await client.getMailboxLock(folder || 'INBOX');
      try {
        const mailbox = client.mailbox;
        const total =
          typeof mailbox === 'object' && mailbox ? (mailbox.exists ?? 0) : 0;

        const items: Record<string, unknown>[] = [];
        // Newest first: page 1 = highest sequence numbers.
        const end = total - (safePage - 1) * safeLimit;
        const start = Math.max(1, end - safeLimit + 1);
        if (end >= 1) {
          for await (const msg of client.fetch(`${start}:${end}`, {
            uid: true,
            envelope: true,
            flags: true,
            bodyStructure: true,
          })) {
            const from = (msg.envelope?.from?.[0] ?? {}) as EnvelopeAddress;
            const to = (msg.envelope?.to ?? []) as EnvelopeAddress[];
            items.push({
              uid: msg.uid,
              subject: msg.envelope?.subject ?? '',
              fromName: from.name ?? '',
              fromAddress: from.address ?? '',
              to: to
                .map((a) => a.address ?? '')
                .filter((a): a is string => a !== ''),
              date: msg.envelope?.date ?? null,
              seen: msg.flags?.has('\\Seen') ?? false,
              hasAttachments: this.structureHasAttachments(msg.bodyStructure),
              snippet: '',
            });
          }
        }
        items.reverse();
        return { items, total, page: safePage, limit: safeLimit };
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(userId: string, uid: number, folder: string) {
    const box = await this.requireMailbox(userId);
    return this.withImap(box, async (client) => {
      const lock = await client.getMailboxLock(folder || 'INBOX');
      try {
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, source: true, flags: true },
          { uid: true },
        );
        if (!msg || !msg.source) {
          throw new NotFoundException('Message not found in this folder.');
        }

        const parsed = await simpleParser(msg.source);
        // Opening a message marks it read (best-effort).
        try {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        } catch {
          // non-fatal
        }

        return {
          uid,
          subject: parsed.subject ?? '',
          fromName: parsed.from?.value?.[0]?.name ?? '',
          fromAddress: parsed.from?.value?.[0]?.address ?? '',
          to: this.addressList(parsed.to),
          cc: this.addressList(parsed.cc),
          date: parsed.date ?? null,
          seen: true,
          bodyHtml: typeof parsed.html === 'string' ? parsed.html : '',
          bodyText: parsed.text ?? '',
          attachments: (parsed.attachments ?? []).map((a) => ({
            filename: a.filename ?? 'attachment',
            size: a.size ?? 0,
            contentType: a.contentType ?? 'application/octet-stream',
          })),
        };
      } finally {
        lock.release();
      }
    });
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

  /** Connect, run `fn`, and always try to logout — mapping connect failures to 502. */
  private async withImap<T>(
    box: LinkedMailbox,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const password = decryptSettingsValue(box.passwordEncrypted);
    const client = this.buildImapClient(box, password);
    try {
      await client.connect();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `IMAP connect failed for mailbox ${box.emailAddress}: ${detail}`,
      );
      throw new BadGatewayException({
        message:
          'Could not connect to the mailbox — the mail server refused the connection or login. Check the mailbox settings or try again shortly.',
        code: 'MAILBOX_CONNECT_FAILED',
      });
    }
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

  private addressList(value: AddressObject | AddressObject[] | undefined) {
    const objects = Array.isArray(value) ? value : value ? [value] : [];
    return objects
      .flatMap((o) => o.value ?? [])
      .map((a) => a.address ?? '')
      .filter((a) => a !== '');
  }

  /** True when any non-inline non-text part exists in the BODYSTRUCTURE tree. */
  private structureHasAttachments(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const struct = node as {
      disposition?: string;
      type?: string;
      childNodes?: unknown[];
    };
    if (struct.disposition?.toLowerCase() === 'attachment') return true;
    if (Array.isArray(struct.childNodes)) {
      return struct.childNodes.some((child) =>
        this.structureHasAttachments(child),
      );
    }
    return false;
  }
}
