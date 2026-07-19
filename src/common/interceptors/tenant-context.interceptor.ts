import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Scope,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { RequestWithAuth } from '../auth.types';
import { TenantContext } from '../providers/tenant-context.provider';

/**
 * Intercepts each request and resolves the active tenantId from:
 *   1. The `x-tenant-id` header (explicit tenant selection from client)
 *   2. The user's memberships (auto-select if only one membership across both systems)
 *
 * Sets the resolved value on the request-scoped TenantContext provider so
 * downstream guards and the Prisma tenant extension can enforce isolation.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = req.auth;

    // No auth context means the route is public or the JWT guard already denied it.
    if (!auth) return next.handle();

    this.tenantContext.setUserId(auth.userId);

    // 1. Explicit tenant selection via header
    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    if (headerTenantId) {
      this.tenantContext.setTenantId(headerTenantId);
      return next.handle();
    }

    // 2. Collect all unique tenant IDs from both membership systems
    const legacyTenantIds = auth.memberships.map((m) => m.shopId);
    const tenantIds = auth.tenantMemberships.map((tm) => tm.tenantId);
    const allTenantIds = [...new Set([...legacyTenantIds, ...tenantIds])];

    // Auto-select if the user has exactly one tenant across both systems
    if (allTenantIds.length === 1) {
      this.tenantContext.setTenantId(allTenantIds[0]);
      return next.handle();
    }

    // If the user has multiple memberships and no header, leave tenantId unresolved.
    // The TenantGuard will enforce membership validation when required.
    return next.handle();
  }
}
