/**
 * Runs pending migrations from the **compiled** build.
 *
 * `npm run migration:run` needs `ts-node` and `src/`, and the cPanel deploy
 * ships neither — it uploads `dist/` and installs with `--omit=dev`. So the
 * usual path cannot be used on production, and migrations ended up being
 * applied out of band. This entrypoint closes that gap: `typeorm` is a runtime
 * dependency and `dist/migrations/*.js` is already deployed, so
 *
 *   node dist/database/run-migrations.js
 *
 * is enough on any host that can reach the database.
 *
 * It deliberately does not invoke the TypeORM CLI. `data-source.ts` switches
 * its migrations glob to `src/migrations/*.ts` whenever it sees a
 * `migration:run` argument, which on a compiled deploy resolves to nothing and
 * reports "no pending migrations" while silently applying none.
 *
 * The legacy-name renumber runs first, for the same reason it does in the npm
 * script: TypeORM reads the executed-migration list once, up front, so a
 * rename applied later is too late and 16 migrations re-run.
 */
import { AppDataSource } from './data-source';
import { renumberLegacyMigrations } from './renumber-legacy-migrations';

async function main(): Promise<void> {
  const renamed = await renumberLegacyMigrations();
  if (renamed > 0) {
    console.log(`Renumbered ${renamed} legacy migration name(s).`);
  }

  const ds = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  const applied = await ds.runMigrations();
  if (applied.length === 0) {
    console.log('No migrations are pending.');
  } else {
    for (const migration of applied) {
      console.log(`Applied ${migration.name}`);
    }
  }

  await ds.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Migration run failed:', err);
    process.exit(1);
  });
