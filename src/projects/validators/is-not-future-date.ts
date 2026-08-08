import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * `completedDate` records when a gate actually passed/failed — a fact about
 * the past, unlike `targetDate`/`scheduledAt` which are legitimately in the
 * future. Reject dates after "today" (server clock, UTC) rather than
 * silently clamping, so a fat-fingered date gets caught at entry instead of
 * quietly corrupting the timeline.
 */
export function IsNotFutureDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value == null) return true;
          if (typeof value !== 'string') return false;
          const today = new Date().toISOString().slice(0, 10);
          return value <= today;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} cannot be in the future`;
        },
      },
    });
  };
}
