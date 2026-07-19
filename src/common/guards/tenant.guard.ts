import { CanActivate, ExecutionContext, Injectable, Logger, Scope } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../api-exception';
import type { RequestWithAuth } from '../auth.types';
import { TenantContext } from '../providers/tenant-context.provider';
import { IS_PUBLIC_KEY } from '../decorators';

/**
 * Validates that the authenticated user has an active membership in the
 * tenant resolved by the TenantContextInterceptor.
 *
 * If a user attempts access to a tenant they don't belong to, the guard
 * denies the request and logs the unauthorized access attempt with user ID,
 * target tenant, and timestamp (per Requirement 5.7).
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = req.auth;

    // If no auth context exists, the JWT guard should have already rejected it.
    if (!auth) return true;

    // If no tenant was resolved (e.g. vehicle-owner-only route), allow through.
    // Routes that need tenant scoping should use this guard explicitly.
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) return true;

    // Check if the user holds an active membership in this tenant.
    // First, try in-memory check from the JWT payload memberships.
    const hasMembershipInToken = auth.memberships.some((m) => m.shopId === tenantId);

    if (hasMembershipInToken) return true;

    // Fall back to a database check for freshness (handles JWT with stale memberships).
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: auth.userId,
        tenantId: tenantId,
      },
    });

    if (membership) return true;

    // Unauthorized access — log and deny (Requirement 5.7)
    this.logger.warn(
      `Unauthorized tenant access attempt: userId=${auth.userId}, targetTenant=${tenantId}, timestamp=${new Date().toISOString()}`,
    );

    throw ApiException.forbidden(
      'You do not have access to this organization.',
    );
  }
}
