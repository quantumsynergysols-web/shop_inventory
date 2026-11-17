import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule, type AppOverrides } from './app.module.js';
import type { AppConfig } from './config.js';

export async function createApp(config: AppConfig, overrides: AppOverrides = {}, options: { quiet?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.create(config, overrides), options.quiet ? { logger: false } : {});
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
