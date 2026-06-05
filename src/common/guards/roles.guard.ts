import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ApiException } from '../api-exception';
import { ROLES_KEY } from '../decorators';
import type { RequestWithAuth } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = req.auth;
    if (!auth) throw ApiException.unauthorized();

    const allowed = auth.memberships.some((m) => roles.includes(m.role));
    if (!allowed) throw ApiException.forbidden('You don’t have access to this area.');
    return true;
  }
}
