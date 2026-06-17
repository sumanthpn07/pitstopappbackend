import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { AuthProvider } from '@prisma/client';
import { ApiException } from '../../common/api-exception';

/** A login identity verified from a Firebase ID token, normalised across providers. */
export interface VerifiedIdentity {
  provider: AuthProvider;
  /** Stable per-provider key: E.164 phone for PHONE, Google `sub` for GOOGLE. */
  subject: string;
  email: string | null;
  phone: string | null;
  name: string | null;
}

/**
 * Verifies Firebase ID tokens (from the app's phone-auth flow) using the
 * Firebase Admin SDK. The Admin app is initialised lazily from a service-account
 * file so the server still boots when Firebase isn't configured yet — only the
 * `/auth/firebase` route fails, with a clear "not configured" error.
 */
@Injectable()
export class FirebaseService {
  private readonly logger = new Logger('Firebase');
  private app?: App;

  constructor(private readonly config: ConfigService) {}

  private getApp(): App {
    if (this.app) return this.app;

    const credsFile = this.config.get<string>('firebase.credentialsFile');
    if (!credsFile) {
      throw new ApiException(
        'FIREBASE_NOT_CONFIGURED',
        'Firebase auth is not configured on the server.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(readFileSync(resolve(credsFile), 'utf8'));
    } catch {
      throw new ApiException(
        'FIREBASE_NOT_CONFIGURED',
        'Firebase service-account file could not be read.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.app = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
    this.logger.log('Firebase Admin initialised.');
    return this.app;
  }

  /** Verify an ID token and normalise it into a provider-agnostic identity. */
  async verifyToken(idToken: string): Promise<VerifiedIdentity> {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this.getApp()).verifyIdToken(idToken);
    } catch (err) {
      if (err instanceof ApiException) throw err; // not-configured
      throw ApiException.unauthorized('Could not verify your sign-in. Please try again.');
    }
    return this.normalise(decoded);
  }

  private normalise(decoded: DecodedIdToken): VerifiedIdentity {
    const signInProvider = decoded.firebase?.sign_in_provider;
    const identities = (decoded.firebase?.identities ?? {}) as Record<string, string[]>;
    const email = decoded.email ?? identities['email']?.[0] ?? null;
    const phone = decoded.phone_number ?? identities['phone']?.[0] ?? null;
    const name = (decoded.name as string | undefined) ?? null;

    // Prefer the explicit sign-in provider; fall back to whichever identity is
    // present (keeps custom-token test logins working when phone is set).
    if (signInProvider === 'google.com' || identities['google.com']) {
      const subject = identities['google.com']?.[0];
      if (!subject) throw ApiException.validation('Google sign-in is missing its account id.');
      return { provider: AuthProvider.GOOGLE, subject, email, phone, name };
    }
    if (signInProvider === 'apple.com' || identities['apple.com']) {
      const subject = identities['apple.com']?.[0];
      if (!subject) throw ApiException.validation('Apple sign-in is missing its account id.');
      return { provider: AuthProvider.APPLE, subject, email, phone, name };
    }
    if (phone) {
      return { provider: AuthProvider.PHONE, subject: phone, email, phone, name };
    }
    throw ApiException.validation('This sign-in has no usable identity.');
  }
}
