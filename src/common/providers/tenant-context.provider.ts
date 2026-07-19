import { Injectable, Scope } from '@nestjs/common';

/**
 * Request-scoped provider that holds the active tenant context for the
 * current HTTP request. Set by the TenantContextInterceptor and consumed
 * by the TenantGuard and the Prisma tenant extension.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private _tenantId: string | null = null;
  private _userId: string | null = null;

  get tenantId(): string | null {
    return this._tenantId;
  }

  get userId(): string | null {
    return this._userId;
  }

  setTenantId(tenantId: string): void {
    this._tenantId = tenantId;
  }

  setUserId(userId: string): void {
    this._userId = userId;
  }

  /** Returns true if a tenant has been resolved for this request. */
  isResolved(): boolean {
    return this._tenantId !== null;
  }
}
