import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Action } from '@erp/domain';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC, REQUIRED_ACTION, type AuthUser } from './decorators.js';

/**
 * Global guard: every route needs a valid access token unless marked @Public(),
 * and @Requires(action) is checked against the permission matrix (SRS §3.11).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const header = req.headers['authorization'] ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m?.[1]) throw new UnauthorizedException('Login required');
    req.user = await this.auth.verifyAccessToken(m[1]);

    const action = this.reflector.getAllAndOverride<Action | undefined>(REQUIRED_ACTION, targets);
    if (action && !can(req.user.role, action)) throw new ForbiddenException(`Your role (${req.user.role}) cannot do ${action}`);
    return true;
  }
}
