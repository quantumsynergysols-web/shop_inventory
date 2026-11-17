import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppOverrides } from './app.module.js';
import type { AppConfig } from './config.js';

export async function createApp(config: AppConfig, overrides: AppOverrides = {}, options: { quiet?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.create(config, overrides), options.quiet ? { logger: false } : {});
  app.setGlobalPrefix('api');
  const web = isAbsolute(config.WEB_DIST) ? config.WEB_DIST : join(process.cwd(), config.WEB_DIST);
  if (existsSync(join(web, 'index.html'))) app.useStaticAssets(web, { index: 'index.html', maxAge: '1h' });
  app.enableShutdownHooks();
  return app;
}
