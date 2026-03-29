import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_RESET_REQUIRED_KEY =
  'auth:allow-password-reset-required';

export const AllowPasswordResetRequired = () =>
  SetMetadata(ALLOW_PASSWORD_RESET_REQUIRED_KEY, true);
