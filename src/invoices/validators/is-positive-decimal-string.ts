import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsPositiveDecimalString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isPositiveDecimalString',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          if (!/^\d+(\.\d+)?$/.test(value)) return false;
          return parseFloat(value) > 0;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a positive decimal string`;
        },
      },
    });
  };
}

