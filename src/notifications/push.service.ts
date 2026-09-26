import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import { DevicesService } from '../devices/devices.service';

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type CachedToken = { accessToken: string; expiresAtMs: number };

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Sends push notifications via FCM HTTP v1. No-op unless a Google service
 * account is configured (`FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_FILE`).
 * Access tokens are minted with a hand-signed RS256 JWT (no google-auth-library
 * dependency) and cached until ~60s before expiry.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly serviceAccount: ServiceAccount | null;
  private cachedToken: CachedToken | null = null;

  constructor(private readonly devices: DevicesService) {
    this.serviceAccount = this.loadServiceAccount();
    this.logger.log(
      this.serviceAccount
        ? `Push notifications enabled (project ${this.serviceAccount.project_id})`
        : 'Push notifications disabled (no FCM_SERVICE_ACCOUNT_JSON/FILE set)',
    );
  }

  isEnabled(): boolean {
    return this.serviceAccount !== null;
  }

  /** Fire-and-forget push to every device registered for these users. Never throws. */
  async notifyUsers(
    userIds: string[],
    notification: { title: string; body?: string | null },
    data?: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.isEnabled() || userIds.length === 0) {
      return;
    }
    try {
      const devices = await this.devices.findTokensForUsers(userIds);
      if (devices.length === 0) {
        return;
      }
      const stringData = data
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, this.stringifyValue(v)]),
          )
        : undefined;
      await Promise.all(
        devices.map((device) =>
          this.sendToToken(device.pushToken, notification, stringData),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `Push fan-out failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sendToToken(
    token: string,
    notification: { title: string; body?: string | null },
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.serviceAccount) return;
    try {
      const accessToken = await this.getAccessToken();
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: notification.title,
                body: notification.body ?? undefined,
              },
              data,
            },
          }),
        },
      );

      if (res.ok) {
        return;
      }

      const errorBody = (await res.json().catch(() => null)) as {
        error?: {
          status?: string;
          details?: Array<{ errorCode?: string }>;
        };
      } | null;
      const errorCode: string | undefined =
        errorBody?.error?.details?.find((d) => d?.errorCode)?.errorCode ??
        errorBody?.error?.status;

      if (
        (res.status === 404 || res.status === 400) &&
        (errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT')
      ) {
        await this.devices.removeByToken(token);
        return;
      }

      this.logger.warn(
        `FCM send failed (${res.status}): ${JSON.stringify(errorBody)}`,
      );
    } catch (err) {
      this.logger.warn(
        `FCM send error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now) {
      return this.cachedToken.accessToken;
    }
    if (!this.serviceAccount) {
      throw new Error('FCM service account not configured');
    }

    const nowSec = Math.floor(now / 1000);
    const assertion = jwt.sign(
      {
        iss: this.serviceAccount.client_email,
        scope: FCM_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat: nowSec,
        exp: nowSec + 3600,
      },
      this.serviceAccount.private_key,
      { algorithm: 'RS256' },
    );

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!res.ok) {
      throw new Error(`OAuth token exchange failed (${res.status})`);
    }

    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.cachedToken = {
      accessToken: json.access_token,
      // Refresh a minute early to avoid using a token that expires mid-flight.
      expiresAtMs: now + (json.expires_in - 60) * 1000,
    };
    return this.cachedToken.accessToken;
  }

  private stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private loadServiceAccount(): ServiceAccount | null {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    const filePath = process.env.FCM_SERVICE_ACCOUNT_FILE;
    let text: string | undefined;
    try {
      if (raw && raw.trim()) {
        text = raw;
      } else if (filePath && filePath.trim()) {
        text = fs.readFileSync(filePath, 'utf8');
      }
      if (!text) return null;

      const parsed = JSON.parse(text) as Partial<ServiceAccount>;
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        this.logger.warn(
          'FCM service account JSON is missing project_id/client_email/private_key; push disabled',
        );
        return null;
      }
      return {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to load FCM service account: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
