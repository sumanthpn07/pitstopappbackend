import type { Request } from 'express';
import type { Role } from '@prisma/client';

export interface AuthMembership {
  id: string;
  shopId: string;
  role: Role;
  shopName: string;
}

/** Resolved identity attached to the request by the JWT guard. */
export interface AuthContext {
  userId: string;
  phone: string | null;
  name: string | null;
  memberships: AuthMembership[];
}

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
}

/** Find the membership for a given role (the shop a user acts in for that role). */
export function membershipForRole(auth: AuthContext, role: Role): AuthMembership | undefined {
  return auth.memberships.find((m) => m.role === role);
}
