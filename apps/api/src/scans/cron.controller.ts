import { Controller, Get, Headers, Inject, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ScansService } from './scans.service.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Daily housekeeping for serverless hosting (Vercel Cron), where in-process timers do not run:
 * marks interrupted scans as failed (FR-AI-07) and removes photos past retention (FR-AI-16).
 */
@Controller('cron')
export class CronController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scans: ScansService,
  ) {}

  @Public()
  @Get('daily')
  async daily(@Headers('authorization') auth?: string) {
    const secret = this.config.CRON_SECRET;
    if (!secret || !auth || !timingSafeEqual(digest(auth), digest(`Bearer ${secret}`))) throw new UnauthorizedException();
    const failed = await this.scans.failInterrupted();
    const photosRemoved = await this.scans.removeExpiredPhotos();
    return { failed, photosRemoved };
  }
}
