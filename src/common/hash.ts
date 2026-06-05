import { createHash, randomBytes, randomInt } from 'crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Opaque, URL-safe random token (used for refresh tokens). */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** A 6-digit numeric OTP. */
export function randomOtp(): string {
  return String(randomInt(100000, 1000000));
}
