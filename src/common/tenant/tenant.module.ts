import { Global, Module } from '@nestjs/common';
import { TenantContext } from '../providers/tenant-context.provider';
import { TenantContextInterceptor } from '../interceptors/tenant-context.interceptor';
import { TenantGuard } from '../guards/tenant.guard';

/**
 * Global module providing the tenant isolation infrastructure:
 * - TenantContext: request-scoped provider holding the active tenantId
 * - TenantContextInterceptor: resolves tenantId from JWT/header
 * - TenantGuard: validates user membership in the target tenant
 *
 * The Prisma tenant extension (tenant-prisma.extension.ts) is used
 * directly by services that need scoped Prisma clients.
 */
@Global()
@Module({
  providers: [TenantContext, TenantContextInterceptor, TenantGuard],
  exports: [TenantContext, TenantContextInterceptor, TenantGuard],
})
export class TenantModule {}
