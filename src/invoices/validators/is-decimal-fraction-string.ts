import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Decimal string in [0, 1] — used for rates stored as fractions
 * (e.g. taxRate "0.10" = 10%; the column is numeric(5,4)).
 */
export function IsDecimalFractionString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isDecimalFractionString',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          if (!/^\d+(\.\d+)?$/.test(value)) return false;
          const parsed = parseFloat(value);
          return parsed >= 0 && parsed <= 1;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a decimal fraction between 0 and 1 (e.g. "0.10" for 10%)`;
        },
      },
    });
  };
}
