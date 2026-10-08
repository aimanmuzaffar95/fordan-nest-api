import type { Request } from 'express';

/**
 * Browser origins allowed to call the API. Shared by CORS (main.ts) and the
 * email-link resolver below so an attacker-supplied `Origin` header can never
 * become the base of a welcome/onboarding link.
 */
export const ALLOWED_WEB_ORIGINS = [
  'http://localhost:8080', // docker dev web
  'http://localhost:8081', // local staging (vite preview)
  'http://localhost:5173', // host dev web (common vite default)
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:5173',
  'https://crm.fordan.com.au',
  'https://api.fordan.com.au',
];

const DEV_FALLBACK = 'http://localhost:5173';

/** The `Origin` header of the request, if any. */
export function webOriginOf(req?: Pick<Request, 'headers'>): string | null {
  const raw = req?.headers?.origin;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Base URL of the CRM web app for links inside emails, resolved as:
 * `WEB_APP_URL` → the calling browser's allow-listed `Origin` → localhost.
 * Always returns a URL without a trailing slash.
 */
export function resolveWebAppUrl(origin?: string | null): string {
  const fromEnv = process.env.WEB_APP_URL?.trim();
  const candidates = [fromEnv, origin, DEV_FALLBACK];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      const normalized = url.origin + url.pathname.replace(/\/+$/, '');
      if (candidate === origin && !ALLOWED_WEB_ORIGINS.includes(url.origin)) {
        continue;
      }
      return normalized;
    } catch {
      continue;
    }
  }
  return DEV_FALLBACK;
}

/** `${web app}/${path}` — `path` without a leading slash. */
export function webAppLink(path: string, origin?: string | null): string {
  return `${resolveWebAppUrl(origin)}/${path.replace(/^\/+/, '')}`;
}
