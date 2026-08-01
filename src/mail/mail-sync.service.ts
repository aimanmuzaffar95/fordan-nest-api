import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { decryptSettingsValue } from '../common/crypto.util';
import { LinkedMailbox } from './linked-mailbox.entity';
import { MailMessage } from './mail-message.entity';

const IMAP_TIMEOUT_MS = 10_000;
/** Newest UIDs per folder to keep summary rows for. */
const SYNC_WINDOW = 200;
/** Newest messages to eagerly fetch full bodies for. */
const BODY_WINDOW = 50;
const CRON_INTERVAL_MS = 5 * 60_000;
const CRON_SKIP_IF_SYNCED_WITHIN_MS = 2 * 60_000;

interface EnvelopeAddress {
  name?: string;
  address?: string;
}

export interface FolderStatus {
  path: string;
  name: string;
  unseen: number;
  specialUse?: string;
}

/** Conservative allowlist — no scripts/styles/iframes/event handlers. */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a',
    'b',
    'i',
    'u',
    'em',
    'strong',
    'p',
    'br',
    'hr',
    'div',
    'span',
    'blockquote',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'img',
    'font',
    'center',
    'small',
    'sub',
    'sup',
  ],
  allowedAttributes: {
    // Preserve visual styling: inline style, class (for <style> blocks),
    // and the common presentational table/cell attributes email uses.
    '*': ['style', 'class', 'align', 'valign', 'bgcolor', 'width', 'height', 'dir'],
    a: ['href', 'title', 'target'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan', 'background'],
    th: ['colspan', 'rowspan', 'background'],
    table: ['border', 'cellpadding', 'cellspacing', 'background'],
    font: ['color', 'size', 'face'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Keep inline style values verbatim (the default CSS re-parser silently
  // drops properties it doesn't recognize, e.g. Outlook mso-* / shorthands).
  parseStyleAttributes: false,
  disallowedTagsMode: 'discard',
};

export function sanitizeMailHtml(html: string): string {
  return sanitizeCssBlocks(
    stripDangerousCss(sanitizeHtml(html, withStyleTag(SANITIZE_OPTIONS))),
  );
}

/**
 * Signature allowlist — slightly more permissive than message bodies: inline
 * `style` is permitted (signatures are hand-authored, not received), plus a few
 * formatting tags. Still no script/style/iframe/event-handlers, and dangerous
 * CSS declarations are stripped in a post-pass. Schemes are limited to
 * http/https/mailto (images http/https only).
 */
const SIGNATURE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'div',
    'span',
    'br',
    'hr',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'h1',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'font',
    'small',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'align', 'valign', 'bgcolor', 'width', 'height', 'dir'],
    a: ['href', 'title', 'target'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan', 'background'],
    th: ['colspan', 'rowspan', 'background'],
    table: ['border', 'cellpadding', 'cellspacing', 'background'],
    font: ['color', 'size', 'face'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  parseStyleAttributes: false,
  disallowedTagsMode: 'discard',
};

/**
 * Allow `<style>` blocks + class so real-world signatures/emails keep their CSS.
 * Safe because output is only ever rendered in a sandboxed iframe (web) or a
 * no-JS WebView (mobile); dangerous CSS is scrubbed in a post-pass.
 */
function withStyleTag(opts: sanitizeHtml.IOptions): sanitizeHtml.IOptions {
  return {
    ...opts,
    allowedTags: [...(Array.isArray(opts.allowedTags) ? opts.allowedTags : []), 'style'],
    allowVulnerableTags: true,
  };
}

/** Scrub dangerous declarations from the CSS text inside <style> blocks. */
function sanitizeCssBlocks(html: string): string {
  return html.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_m, attrs: string, css: string) => {
      const cleaned = css
        .replace(/@import[^;]*;?/gi, '')
        .replace(/expression\s*\(/gi, '(')
        .replace(/javascript:/gi, '')
        .replace(/behavior\s*:/gi, 'x-behavior:')
        .replace(/position\s*:\s*fixed/gi, 'position:static');
      return `<style${attrs}>${cleaned}</style>`;
    },
  );
}

/** Drop dangerous declarations from inline style attributes. */
function stripDangerousCss(html: string): string {
  return html.replace(/style="([^"]*)"/gi, (_match, css: string) => {
    const cleaned = css
      .split(';')
      .map((decl) => decl.trim())
      .filter((decl) => decl.length > 0)
      .filter((decl) => {
        const v = decl.toLowerCase().replace(/\s+/g, '');
        if (v.includes('expression(')) return false;
        if (v.includes('url(javascript:')) return false;
        if (v.includes("url('javascript:")) return false;
        if (v.includes('url("javascript:')) return false;
        if (v.includes('position:fixed')) return false;
        return true;
      })
      .join('; ');
    return cleaned ? `style="${cleaned}"` : '';
  });
}

export function sanitizeSignatureHtml(html: string): string {
  return sanitizeCssBlocks(
    stripDangerousCss(sanitizeHtml(html, withStyleTag(SIGNATURE_SANITIZE_OPTIONS))),
  );
}

/**
 * Background IMAP → DB sync. One IMAP connection per mailbox per run; runs
 * are sequential across mailboxes so a throttling shared host never sees
 * parallel connections from us. Sync failures are recorded on the mailbox
 * (lastSyncError) and never propagate to readers.
 */
@Injectable()
export class MailSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailSyncService.name);
  private cronHandle: ReturnType<typeof setInterval> | null = null;
  /** Serializes all sync work (cron + on-demand) — never parallel. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(LinkedMailbox)
    private readonly mailboxes: Repository<LinkedMailbox>,
    @InjectRepository(MailMessage)
    private readonly messages: Repository<MailMessage>,
  ) {}

  onModuleInit() {
    if (process.env.MAIL_SYNC_DISABLED === 'true') return;
    this.cronHandle = setInterval(() => {
      this.syncAllMailboxes().catch((err: unknown) => {
        this.logger.error('Cron mail sync failed', err);
      });
    }, CRON_INTERVAL_MS);
    this.cronHandle.unref?.();
  }

  onModuleDestroy() {
    if (this.cronHandle) clearInterval(this.cronHandle);
  }

  /** Enqueue a sync so runs never overlap. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async syncAllMailboxes(): Promise<void> {
    const boxes = await this.mailboxes.find({ where: { active: true } });
    for (const box of boxes) {
      if (
        box.lastSyncedAt &&
        Date.now() - new Date(box.lastSyncedAt).getTime() <
          CRON_SKIP_IF_SYNCED_WITHIN_MS
      ) {
        continue;
      }
      await this.syncMailbox(box.id).catch(() => undefined);
    }
  }

  /**
   * Sync one mailbox over a single IMAP connection. Never throws — errors are
   * stored in linked_mailboxes.lastSyncError and swallowed.
   */
  syncMailbox(
    mailboxId: string,
    opts: { folder?: string } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    return this.enqueue(() => this.syncMailboxNow(mailboxId, opts));
  }

  private async syncMailboxNow(
    mailboxId: string,
    opts: { folder?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const box = await this.mailboxes.findOne({ where: { id: mailboxId } });
    if (!box || !box.active) return { ok: false, error: 'Mailbox not found' };

    let client: ImapFlow | null = null;
    try {
      client = this.buildImapClient(box);
      await client.connect();

      // Folder list + unseen counts, captured on the same connection.
      const folderList = await this.collectFolders(client);
      if (folderList.length > 0) box.foldersJson = folderList;

      const folders = this.pickSyncFolders(folderList, opts.folder);
      for (const folderPath of folders) {
        await this.syncFolder(client, box, folderPath);
      }

      box.lastSyncedAt = new Date();
      box.lastSyncError = null;
      await this.mailboxes.save(box);
      return { ok: true };
    } catch (error: unknown) {
      const detail = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      this.logger.warn(`Mail sync failed for ${box.emailAddress}: ${detail}`);
      box.lastSyncedAt = new Date();
      box.lastSyncError = detail;
      await this.mailboxes.save(box).catch(() => undefined);
      return { ok: false, error: detail };
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      }
    }
  }

  /** Folder list with unseen counts on the already-open connection. */
  private async collectFolders(client: ImapFlow): Promise<FolderStatus[]> {
    const items: FolderStatus[] = [];
    try {
      const folders = await client.list();
      for (const folder of folders) {
        if (folder.flags?.has('\\Noselect')) continue;
        let unseen = 0;
        try {
          const status = await client.status(folder.path, { unseen: true });
          unseen = status.unseen ?? 0;
        } catch {
          // some servers refuse STATUS — report 0
        }
        items.push({
          path: folder.path,
          name: folder.name,
          unseen,
          ...(folder.specialUse === '\\Sent' ? { specialUse: '\\Sent' } : {}),
        });
      }
    } catch {
      // folder listing failed — sync INBOX only this round
    }
    return items;
  }

  /** INBOX + the Sent-equivalent folder (or the explicitly requested one). */
  private pickSyncFolders(
    folderList: FolderStatus[],
    requested?: string,
  ): string[] {
    if (requested) return [requested];
    const result = ['INBOX'];
    const sent =
      folderList.find((f) => f.specialUse === '\\Sent') ??
      folderList.find((f) => /sent/i.test(f.name));
    if (sent && sent.path !== 'INBOX') result.push(sent.path);
    return result;
  }

  private async syncFolder(
    client: ImapFlow,
    box: LinkedMailbox,
    folderPath: string,
  ): Promise<void> {
    const lock = await client.getMailboxLock(folderPath);
    try {
      const mailbox = client.mailbox;
      const total =
        typeof mailbox === 'object' && mailbox ? (mailbox.exists ?? 0) : 0;
      const now = new Date();

      const seenUids = new Set<number>();
      const summaries = new Map<
        number,
        {
          subject: string;
          fromName: string;
          fromAddress: string;
          to: string[];
          cc: string[];
          date: Date | null;
          seen: boolean;
          hasAttachments: boolean;
        }
      >();

      const start = Math.max(1, total - SYNC_WINDOW + 1);
      if (total >= 1) {
        for await (const msg of client.fetch(`${start}:${total}`, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
        })) {
          const from = (msg.envelope?.from?.[0] ?? {}) as EnvelopeAddress;
          const to = (msg.envelope?.to ?? []) as EnvelopeAddress[];
          const cc = (msg.envelope?.cc ?? []) as EnvelopeAddress[];
          seenUids.add(msg.uid);
          summaries.set(msg.uid, {
            subject: msg.envelope?.subject ?? '',
            fromName: (from.name ?? '').slice(0, 255),
            fromAddress: (from.address ?? '').slice(0, 320),
            to: to.map((a) => a.address ?? '').filter((a) => a !== ''),
            cc: cc.map((a) => a.address ?? '').filter((a) => a !== ''),
            date: msg.envelope?.date ?? null,
            seen: msg.flags?.has('\\Seen') ?? false,
            hasAttachments: this.structureHasAttachments(msg.bodyStructure),
          });
        }
      }

      // Upsert summaries.
      const existing = await this.messages.find({
        where: { mailboxId: box.id, folder: folderPath },
      });
      const existingByUid = new Map(existing.map((m) => [m.uid, m]));

      for (const [uid, s] of summaries) {
        const row = existingByUid.get(uid);
        if (row) {
          if (row.seen !== s.seen || row.hasAttachments !== s.hasAttachments) {
            row.seen = s.seen;
            row.hasAttachments = s.hasAttachments;
          }
          row.syncedAt = now;
          await this.messages.save(row);
        } else {
          await this.messages
            .save(
              this.messages.create({
                mailboxId: box.id,
                folder: folderPath,
                uid,
                subject: s.subject,
                fromName: s.fromName,
                fromAddress: s.fromAddress,
                toJson: s.to,
                ccJson: s.cc,
                date: s.date,
                seen: s.seen,
                hasAttachments: s.hasAttachments,
                snippet: '',
                bodyHtml: null,
                bodyText: null,
                attachmentsJson: null,
                syncedAt: now,
              }),
            )
            .catch(() => undefined); // unique-race safe
        }
      }

      // Prune synthetic just-sent rows (negative uid) once the real copies
      // are synced from the server.
      if (summaries.size > 0) {
        const synthetic = existing.filter((m) => m.uid < 0);
        if (synthetic.length > 0) {
          await this.messages.delete({ id: In(synthetic.map((m) => m.id)) });
        }
      }

      // Delete rows whose UID vanished — but only within the synced window,
      // so older messages we no longer look at are never mass-deleted.
      if (summaries.size > 0) {
        const minSyncedUid = Math.min(...summaries.keys());
        const vanished = existing.filter(
          (m) => m.uid >= minSyncedUid && !seenUids.has(m.uid),
        );
        if (vanished.length > 0) {
          await this.messages.delete({ id: In(vanished.map((m) => m.id)) });
        }
      }

      // Fetch full bodies for the newest BODY_WINDOW messages lacking one.
      const newestUids = [...summaries.keys()]
        .sort((a, b) => b - a)
        .slice(0, BODY_WINDOW);
      for (const uid of newestUids) {
        const row =
          existingByUid.get(uid) ??
          (await this.messages.findOne({
            where: { mailboxId: box.id, folder: folderPath, uid },
          }));
        if (!row || row.bodyText !== null || row.bodyHtml !== null) continue;
        try {
          const full = await client.fetchOne(
            String(uid),
            { uid: true, source: true },
            { uid: true },
          );
          if (full && full.source) {
            await this.storeParsedBody(row, full.source);
          }
        } catch {
          // body fetch failed — summary row stays; detail view will retry
        }
      }
    } finally {
      lock.release();
    }
  }

  /** Parse a raw RFC822 source, sanitize, and persist onto the given row. */
  async storeParsedBody(row: MailMessage, source: Buffer): Promise<void> {
    const parsed = await simpleParser(source);
    const bodyText = parsed.text ?? '';
    const bodyHtml =
      typeof parsed.html === 'string' ? sanitizeMailHtml(parsed.html) : '';
    row.bodyText = bodyText;
    row.bodyHtml = bodyHtml;
    row.snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 300);
    row.attachmentsJson = (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      size: a.size ?? 0,
      contentType: a.contentType ?? 'application/octet-stream',
    }));
    row.syncedAt = new Date();
    await this.messages.save(row);
  }

  buildImapClient(box: LinkedMailbox): ImapFlow {
    return new ImapFlow({
      host: box.imapHost,
      port: box.imapPort,
      secure: box.imapSecure,
      auth: {
        user: box.username,
        pass: decryptSettingsValue(box.passwordEncrypted),
      },
      logger: false,
      connectionTimeout: IMAP_TIMEOUT_MS,
      greetingTimeout: IMAP_TIMEOUT_MS,
      socketTimeout: IMAP_TIMEOUT_MS * 3,
    });
  }

  private structureHasAttachments(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const struct = node as {
      disposition?: string;
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
