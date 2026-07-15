// E2E suites run against an in-memory sqljs database. Entity column types are
// dialect-resolved at import time (see src/common/timestamp-column-type.util.ts),
// so the dialect must be set before any entity module loads.
process.env.DB_DIALECT = process.env.DB_DIALECT ?? 'sqljs';
