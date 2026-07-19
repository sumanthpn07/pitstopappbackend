/**
 * VIN (Vehicle Identification Number) validation utility.
 *
 * A valid VIN is:
 * - Exactly 17 characters
 * - Only alphanumeric (A-Z, 0-9)
 * - Excludes I, O, Q (ambiguous characters)
 *
 * Input is case-insensitive; VINs are stored in uppercase.
 */

const VIN_LENGTH = 17;
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export interface VinValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

export function validateVin(vin: string): VinValidationResult {
  if (!vin || typeof vin !== 'string') {
    return { valid: false, error: 'VIN is required.' };
  }

  const normalized = vin.toUpperCase().trim();

  if (normalized.length !== VIN_LENGTH) {
    return {
      valid: false,
      error: `VIN must be exactly ${VIN_LENGTH} characters, got ${normalized.length}.`,
    };
  }

  if (!VIN_PATTERN.test(normalized)) {
    // Determine specific violation
    const invalidChars = normalized.split('').filter((ch) => !/[A-HJ-NPR-Z0-9]/.test(ch));
    if (invalidChars.some((ch) => ch === 'I' || ch === 'O' || ch === 'Q')) {
      return {
        valid: false,
        error: 'VIN must not contain the letters I, O, or Q.',
      };
    }
    return {
      valid: false,
      error: 'VIN must contain only alphanumeric characters (A-Z, 0-9), excluding I, O, Q.',
    };
  }

  return { valid: true, normalized };
}
