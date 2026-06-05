import { Transform } from 'class-transformer';
import { Matches, ValidationOptions } from 'class-validator';

export const CM_PHONE_REGEX = /^6\d{8}$/;
export const CM_PHONE_MESSAGE = 'Le numéro de téléphone doit contenir 9 chiffres et commencer par 6';

export function NormalizeRequiredCmPhone() {
  return Transform(({ value }) => String(value ?? '').replace(/\D/g, ''));
}

export function NormalizeOptionalCmPhone() {
  return Transform(({ value }) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits || undefined;
  });
}

export function IsCmPhone(validationOptions?: ValidationOptions) {
  return Matches(CM_PHONE_REGEX, {
    message: CM_PHONE_MESSAGE,
    ...validationOptions,
  });
}
