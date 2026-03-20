import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Interactive OpenAPI (Swagger UI) for manual API exploration — not automated tests.
 *
 * - Unset / other: enabled when NODE_ENV is not `production`.
 * - `API_OPENAPI=true` | `1` | `yes`: force enable (e.g. Docker staging).
 * - `API_OPENAPI=false` | `0` | `no`: force disable (e.g. production).
 */
export function shouldEnableOpenApi(): boolean {
  let raw = (process.env.API_OPENAPI ?? '').trim().toLowerCase();
  // .env sometimes uses quotes; Docker can preserve them in edge cases
  raw = raw.replace(/^['"]|['"]$/g, '');
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  return (process.env.NODE_ENV ?? 'development').toLowerCase() !== 'production';
}

/** @returns whether Swagger UI was mounted */
export function setupOpenApi(app: INestApplication): boolean {
  if (!shouldEnableOpenApi()) {
    return false;
  }

  const config = new DocumentBuilder()
    .setTitle('Fordan Solar CRM API')
    .setDescription(
      'Interactive OpenAPI for **manual** requests. Responses are wrapped as `{ success, data, ... }` (see `docs/API_CONTRACT.md`). Click **Authorize** and paste the JWT (from **POST /auth/login**) without the `Bearer` prefix. **Installer role** vs **Setup API:** see contract § RBAC terminology. **Customers:** `POST /customers` allows the **installer role**; other customer routes need **admin/manager**. **Teams:** `GET /teams` allows **installer** (read-only); mutations are **admin/manager**; **DELETE** is **admin** only. **Schedule:** **`GET /schedule`** — `from`/`to` (+ optional `teamId`); installer scoped. **Metering:** **`PATCH /meter-applications/:id`** (**admin/manager**). **Assignments:** `/jobs/:jobId/assignments` (installer **GET** only); **`POST /assignments/:id/lock`** (**admin/manager**); locked assignments cannot be **DELETE**d until unlocked.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Installer-Setup-Token',
        in: 'header',
        description:
          'Public **setup** (DB bootstrap) only when INSTALLER_PUBLIC_DATABASE_STATE=true — not the installer user role',
      },
      'installer-setup-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // Match global prefix `api` so UI lives at /api/docs (not /docs — easy to mistake)
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  return true;
}
