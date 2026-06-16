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
import { ApiException } from '../../common/api-exception';

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

  /** Verify an ID token and return the verified phone number + Firebase uid. */
  async verifyPhoneToken(idToken: string): Promise<{ uid: string; phone: string }> {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this.getApp()).verifyIdToken(idToken);
    } catch (err) {
      if (err instanceof ApiException) throw err; // not-configured
      throw ApiException.unauthorized('Could not verify your sign-in. Please try again.');
    }
    if (!decoded.phone_number) {
      throw ApiException.validation('This sign-in has no phone number.');
    }
    return { uid: decoded.uid, phone: decoded.phone_number };
  }
}
