import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { randomOtp, sha256 } from '../../common/hash';
import type { AuthContextDTO, LinkResultDTO, OtpRequestResultDTO, SwitchTenantResultDTO, TokensDTO } from '../../domain/contracts';
import { TokensService } from './tokens.service';
import { FirebaseService } from './firebase.service';
import { IdentityService } from './identity.service';
import type { FirebaseLoginDto, OtpRequestDto, OtpVerifyDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: TokensService,
    private readonly firebase: FirebaseService,
    private readonly identities: IdentityService,
  ) {}

  async requestOtp(dto: OtpRequestDto): Promise<OtpRequestResultDTO> {
    const ttl = this.config.getOrThrow<number>('otp.ttl');
    const code = randomOtp();
    await this.prisma.otpChallenge.create({
      data: {
        phone: dto.phone,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    const expose = this.config.getOrThrow<boolean>('otp.exposeDevCode');
    // In production the code is delivered over SMS; in the demo we surface it.
    return { expiresInSeconds: ttl, ...(expose ? { devCode: code } : {}) };
  }

  async verifyOtp(dto: OtpVerifyDto): Promise<TokensDTO> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone: dto.phone, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw ApiException.otpInvalid('Request a code first.');
    if (challenge.expiresAt.getTime() < Date.now()) throw ApiException.otpExpired();
    if (challenge.codeHash !== sha256(dto.code.trim())) throw ApiException.otpInvalid();

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    // Dev OTP path resolves through the same identity model as Firebase.
    const user = await this.identities.resolveLogin(
      { provider: AuthProvider.PHONE, subject: dto.phone, phone: dto.phone, email: null, name: null },
      dto.shopId,
    );
    return this.tokens.issueSession(user.id);
  }

  refresh(refreshToken: string): Promise<TokensDTO> {
    return this.tokens.rotate(refreshToken);
  }

  /**
   * Phone/Google/Apple verification is done by Firebase on the client; here we
   * verify the resulting ID token, resolve/provision the account via the
   * identity model, and mint our own session — so the rest of the API keeps
   * using our JWT + refresh model.
   */
  async loginWithFirebase(dto: FirebaseLoginDto): Promise<TokensDTO> {
    const identity = await this.firebase.verifyToken(dto.idToken);
    const user = await this.identities.resolveLogin(identity, dto.shopId);
    return this.tokens.issueSession(user.id);
  }

  /** Link the identity behind a Firebase token to the signed-in account. Reports a
   *  merge confirmation instead of merging unless `confirmMerge` is set. */
  async linkFirebase(
    currentUserId: string,
    idToken: string,
    confirmMerge = false,
  ): Promise<LinkResultDTO> {
    const identity = await this.firebase.verifyToken(idToken);
    return this.identities.linkIdentity(currentUserId, identity, confirmMerge);
  }

  /** Remove a login method from the signed-in account. */
  async unlinkProvider(currentUserId: string, provider: AuthProvider): Promise<void> {
    await this.identities.unlinkIdentity(currentUserId, provider);
  }

  /**
   * Returns the user's available tenant contexts and roles.
   * Called after login so the frontend knows which context to operate in.
   */
  async getContext(userId: string): Promise<AuthContextDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { shop: true } },
        tenantMemberships: { include: { tenant: true } },
      },
    });
    if (!user) throw ApiException.unauthorized();

    return {
      userId: user.id,
      name: user.name,
      memberships: user.memberships.map((m) => ({
        id: m.id,
        shopId: m.shopId,
        role: m.role,
        shopName: m.shop.name,
      })),
      tenantMemberships: user.tenantMemberships.map((tm) => ({
        tenantId: tm.tenantId,
        tenantName: tm.tenant.name,
        role: tm.role,
      })),
    };
  }

  /**
   * Validates that the user holds a membership in the target tenant
   * and returns the tenant context details. The frontend uses the
   * x-tenant-id header approach for runtime switching; this endpoint
   * provides validation and context metadata.
   */
  async switchTenant(userId: string, tenantId: string): Promise<SwitchTenantResultDTO> {
    // Check legacy memberships first
    const legacyMembership = await this.prisma.membership.findFirst({
      where: { userId, shopId: tenantId },
      include: { shop: true },
    });
    if (legacyMembership) {
      return {
        tenantId: legacyMembership.shopId,
        tenantName: legacyMembership.shop.name,
        role: legacyMembership.role,
      };
    }

    // Check tenant memberships
    const tenantMembership = await this.prisma.tenantMembership.findFirst({
      where: { userId, tenantId },
      include: { tenant: true },
    });
    if (tenantMembership) {
      return {
        tenantId: tenantMembership.tenantId,
        tenantName: tenantMembership.tenant.name,
        role: tenantMembership.role,
      };
    }

    throw ApiException.forbidden('You do not have membership in this organization.');
  }
}
