/**
 * TypeORM column types are dialect-specific:
 * - sqljs (in-memory tests) doesn't support `timestamp`.
 * - Postgres doesn't support `datetime` in TypeORM's validator.
 * Resolve the right nullable-timestamp column type for the active dialect.
 */
function activeDialect(): string {
  const raw =
    process.env.DB_DIALECT ??
    process.env.DATABASE_DIALECT ??
    process.env.TYPEORM_CONNECTION ??
    'postgres';
  return raw.trim().toLowerCase();
}

export function resolveTimestampColumnType(): 'timestamp' | 'datetime' {
  return activeDialect().includes('postgres') ? 'timestamp' : 'datetime';
}

/** sqljs/sqlite have no native enum; TypeORM maps `simple-enum` to a CHECK. */
export function resolveEnumColumnType(): 'enum' | 'simple-enum' {
  const dialect = activeDialect();
  return dialect.includes('sqljs') || dialect.includes('sqlite')
    ? 'simple-enum'
    : 'enum';
}
