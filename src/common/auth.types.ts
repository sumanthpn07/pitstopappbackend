import type { Request } from 'express';
import type { Role } from '@prisma/client';

export interface AuthMembership {
  id: string;
  shopId: string;
  role: Role;
  shopName: string;
}

export interface TenantAuthMembership {
  id: string;
  tenantId: string;
  role: Role;
  tenantName: string;
}

/** Resolved identity attached to the request by the JWT guard. */
export interface AuthContext {
  userId: string;
  phone: string | null;
  name: string | null;
  memberships: AuthMembership[];
  tenantMemberships: TenantAuthMembership[];
}

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
}

/** Find the membership for a given role (the shop a user acts in for that role). */
export function membershipForRole(auth: AuthContext, role: Role): AuthMembership | undefined {
  return auth.memberships.find((m) => m.role === role);
}

/** Find the tenant membership for a given role in the active tenant context. */
export function tenantMembershipForRole(
  auth: AuthContext,
  role: Role,
  tenantId?: string | null,
): TenantAuthMembership | undefined {
  if (tenantId) {
    return auth.tenantMemberships.find((m) => m.role === role && m.tenantId === tenantId);
  }
  return auth.tenantMemberships.find((m) => m.role === role);
}
