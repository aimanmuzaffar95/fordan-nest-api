import { Injectable } from '@nestjs/common';

/**
 * Runtime in-memory settings.
 *
 * Notes:
 * - This is intentionally not persisted (no DB/migrations) to keep staging/dev safe.
 * - Restarting the container resets defaults.
 */
@Injectable()
export class RuntimeSettingsService {
  private calendarScopeEnforced = true;

  getCalendarScopeEnforced(): boolean {
    return this.calendarScopeEnforced;
  }

  setCalendarScopeEnforced(v: boolean): void {
    this.calendarScopeEnforced = v;
  }
}

