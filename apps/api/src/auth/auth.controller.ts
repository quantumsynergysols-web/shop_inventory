import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService, type TokenPair } from './auth.service.js';
import { CurrentUser, Public, type AuthUser } from './decorators.js';

const loginBody = z.object({
  /** Phone number or email (FR-AUTH-01) */
  login: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
});
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginBody)) body: z.infer<typeof loginBody>, @Headers('user-agent') ua?: string): Promise<TokenPair> {
    return this.auth.login(body.login, body.password, ua?.slice(0, 300) ?? null);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshBody)) body: z.infer<typeof refreshBody>): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshBody)) body: z.infer<typeof refreshBody>): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
