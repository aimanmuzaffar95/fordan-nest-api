import { timingSafeEqual } from 'node:crypto';

/**
 * When `API_SMOKE_SECRET` is set on the API and the login request sends the
 * same value in `X-Fordan-Smoke-Secret`, auth login skips writing
 * `system_audit_logs` rows (CI/smoke | no persistent side effects).
 */
export function shouldSkipLoginSystemAuditHeader(
  raw: string | string[] | undefined,
): boolean {
  const secret = process.env.API_SMOKE_SECRET?.trim();
  if (!secret) {
    return false;
  }
  const header = Array.isArray(raw) ? raw[0] : raw;
  const h = header?.trim();
  if (!h) {
    return false;
  }
  const a = Buffer.from(secret, 'utf8');
  const b = Buffer.from(h, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
