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
  if (trimmed.length > 0) return trimmed;

  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error(
      'JWT_SECRET is missing or empty. Set a non-empty string (e.g. in apps/api/.env.staging for Docker staging).',
    );
  }
  return 'development-secret';
}
