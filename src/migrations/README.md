# Migrations folder

TypeORM migrations will be generated into this folder.

- In development you generate migrations using the CLI and commit the generated files.
- In production you run `migration:run` during deployment to apply any pending migrations.

See:

- `docs/sops/SOP_MIGRATIONS_PRODUCTION.md`

Notes:

- TypeORM orders migrations by the trailing 13-digit timestamp in the migration class name, not by the file name prefix alone.
- Keep those class-name timestamps unique and increasing, especially when a migration depends on tables created by an earlier migration.
