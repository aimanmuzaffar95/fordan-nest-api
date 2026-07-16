#!/usr/bin/env node
/**
 * Fails if any @Entity('table') has no migration that mentions its table name.
 * Guards against the "works in dev via synchronize, 500s under migrations"
 * class that bit equipment_items, staff_availability, and device_registrations
 * (QA-6, QA-13). Run in CI: `node scripts/check-entity-migrations.mjs`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const migrationsBlob = files
  .filter((f) => f.includes(`${join('src', 'migrations')}`) || f.includes('/migrations/'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const tables = new Set();
for (const f of files) {
  if (f.includes('/migrations/')) continue;
  const src = readFileSync(f, 'utf8');
  const re = /@Entity\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) tables.add(m[1]);
}

const missing = [...tables]
  .filter((t) => !migrationsBlob.includes(`'${t}'`) && !migrationsBlob.includes(`"${t}"`))
  .sort();

if (missing.length > 0) {
  console.error(
    `\n✗ ${missing.length} entity table(s) have no migration:\n` +
      missing.map((t) => `  - ${t}`).join('\n') +
      `\n\nAdd a migration that creates each table (see 20260716-CreateEquipmentItems.ts).\n`,
  );
  process.exit(1);
}

console.log(`✓ all ${tables.size} entity tables have migration coverage`);
