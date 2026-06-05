import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { ApiException } from './api-exception';
import type { AuthContext, RequestWithAuth } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skip the JWT guard for this route (used by the auth endpoints + catalog reads). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Require the signed-in user to hold one of these membership roles. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Inject the resolved AuthContext for the current request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.auth) throw ApiException.unauthorized();
    return req.auth;
  },
);
