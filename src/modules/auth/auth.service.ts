import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { randomOtp, sha256 } from '../../common/hash';
import type { OtpRequestResultDTO, TokensDTO } from '../../domain/contracts';
import { TokensService } from './tokens.service';
import { FirebaseService } from './firebase.service';
import type { FirebaseLoginDto, OtpRequestDto, OtpVerifyDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: TokensService,
    private readonly firebase: FirebaseService,
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

    const user = await this.resolveUser(dto.phone, dto.shopId);
    return this.tokens.issueSession(user.id);
  }

  refresh(refreshToken: string): Promise<TokensDTO> {
    return this.tokens.rotate(refreshToken);
  }

  /**
   * Phone verification is done by Firebase on the client; here we verify the
   * resulting ID token, then resolve/provision the user and mint our own
   * session — so the rest of the API keeps using our JWT + refresh model.
   */
  async loginWithFirebase(dto: FirebaseLoginDto): Promise<TokensDTO> {
    const { phone } = await this.firebase.verifyPhoneToken(dto.idToken);
    const user = await this.resolveUser(phone, dto.shopId);
    return this.tokens.issueSession(user.id);
  }

  /**
   * Staff (and any returning user) already exist, keyed by phone. A brand-new
   * phone is provisioned as a CUSTOMER of the requested (or default) shop.
   */
  private async resolveUser(phone: string, shopId?: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) return existing;

    const targetShopId = shopId ?? this.config.getOrThrow<string>('defaultShopId');
    const shop =
      (await this.prisma.shop.findUnique({ where: { id: targetShopId } })) ??
      (await this.prisma.shop.findFirst());
    if (!shop) throw ApiException.validation('No shop is configured.');

    return this.prisma.user.create({
      data: {
        phone,
        memberships: { create: { shopId: shop.id, role: Role.CUSTOMER } },
      },
    });
  }
}
