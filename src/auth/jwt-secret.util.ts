/**
 * jsonwebtoken rejects an empty secret ("secretOrPrivateKey must have a value").
 * `process.env.JWT_SECRET ?? 'fallback'` is wrong when the var is set to "".
 */
export function resolveJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  const trimmed =
    typeof raw === 'string'
      ? raw.trim()
      : raw === undefined || raw === null
        ? ''
        : String(raw).trim();
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  if (nodeEnv === 'production' && trimmed === 'development-secret') {
    throw new Error(
      'JWT_SECRET is set to the development fallback value. Generate a strong secret (e.g. `openssl rand -hex 32`) before running in production.',
    );
  }
  if (trimmed.length > 0) return trimmed;

  if (nodeEnv === 'production') {
    throw new Error(
      'JWT_SECRET is missing or empty. Set a non-empty string (e.g. in apps/api/.env.staging for Docker staging).',
    );
  }
  return 'development-secret';
}
