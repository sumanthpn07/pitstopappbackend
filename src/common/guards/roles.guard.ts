import { CanActivate, ExecutionContext, Injectable, Logger, Scope } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ApiException } from '../api-exception';
import { ROLES_KEY } from '../decorators';
import type { RequestWithAuth } from '../auth.types';
import { TenantContext } from '../providers/tenant-context.provider';

@Injectable({ scope: Scope.REQUEST })
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = req.auth;
    if (!auth) throw ApiException.unauthorized();

    const activeTenantId = this.tenantContext.tenantId;

    // Check legacy memberships and tenant memberships for the required role
    let allowed: boolean;
    if (activeTenantId) {
      // When a tenant context is active, scope role checks to that tenant
      allowed = auth.memberships.some(
        (m) => roles.includes(m.role) && m.shopId === activeTenantId,
      );
      // Also check tenant memberships for the active tenant
      if (!allowed) {
        allowed = auth.tenantMemberships.some(
          (tm) => roles.includes(tm.role) && tm.tenantId === activeTenantId,
        );
      }
    } else {
      // No tenant context: allow if user holds the role in any membership
      allowed = auth.memberships.some((m) => roles.includes(m.role));
      if (!allowed) {
        allowed = auth.tenantMemberships.some((tm) => roles.includes(tm.role));
      }
    }

    if (!allowed) {
      this.logger.warn(
        `Role access denied: userId=${auth.userId}, requiredRoles=${roles.join(',')}, tenantId=${activeTenantId ?? 'none'}, timestamp=${new Date().toISOString()}`,
      );
      throw ApiException.forbidden("You don't have access to this area.");
    }
    return true;
  }
}
