import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../api-exception';
import { IS_PUBLIC_KEY } from '../decorators';
import type { AuthContext, RequestWithAuth } from '../auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw ApiException.unauthorized();
    }
    const token = header.slice('Bearer '.length).trim();

    let payload: { sub?: string; type?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('jwt.secret'),
      });
    } catch {
      throw ApiException.unauthorized('Your session has expired. Please sign in again.');
    }
    if (payload.type !== 'access' || !payload.sub) {
      throw ApiException.unauthorized();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { memberships: { include: { shop: true } } },
    });
    if (!user) throw ApiException.unauthorized();

    const auth: AuthContext = {
      userId: user.id,
      phone: user.phone,
      name: user.name,
      memberships: user.memberships.map((m) => ({
        id: m.id,
        shopId: m.shopId,
        role: m.role,
        shopName: m.shop.name,
      })),
    };
    req.auth = auth;
    return true;
  }
}
