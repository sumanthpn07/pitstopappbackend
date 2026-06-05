import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { randomToken, sha256 } from '../../common/hash';
import type { TokensDTO } from '../../domain/contracts';

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Mint a fresh access (JWT) + refresh (opaque, stored hashed) pair. */
  async issueSession(userId: string): Promise<TokensDTO> {
    const secret = this.config.getOrThrow<string>('jwt.secret');
    const accessTtl = this.config.getOrThrow<number>('jwt.accessTtl');
    const refreshDays = this.config.getOrThrow<number>('jwt.refreshTtlDays');

    const accessToken = await this.jwt.signAsync(
      { sub: userId, type: 'access' },
      { secret, expiresIn: accessTtl },
    );

    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + refreshDays * 86_400_000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  /** Rotate a refresh token: validate, revoke, and issue a new session. */
  async rotate(refreshToken: string): Promise<TokensDTO> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      throw ApiException.unauthorized('Session expired. Please sign in again.');
    }
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return this.issueSession(row.userId);
  }
}
