import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Action, Role } from '@erp/domain';

export const IS_PUBLIC = 'erp:isPublic';
export const REQUIRED_ACTION = 'erp:requiredAction';

/** Route needs no login (health, login, refresh). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route needs a role that may do this action (permission matrix, SRS §3.11). */
export const Requires = (action: Action) => SetMetadata(REQUIRED_ACTION, action);

/** Who is calling. Every query must be scoped to shopId (FR-AUTH-03, NFR-SEC-02). */
export interface AuthUser {
  userId: string;
  shopId: string;
  role: Role;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!req.user) throw new Error('CurrentUser used on a route without AuthGuard');
  return req.user;
});
