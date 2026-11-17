import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { HEALTH_PROBE, type HealthProbe } from './health.probe.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBE) private readonly probe: HealthProbe) {}

  @Public()
  @Get()
  async get(): Promise<{ status: 'ok' | 'degraded'; db: 'up' | 'down' }> {
    const db = (await this.probe.dbUp()) ? 'up' : 'down';
    return { status: db === 'up' ? 'ok' : 'degraded', db };
  }
}
