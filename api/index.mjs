// Vercel serverless entry: the same NestJS app as on a server, created once per warm instance.
// vercel.json sends /api/* here; the product website and the web app are static files.
import { createApp } from '../apps/api/dist/app.js';
import { loadConfig } from '../apps/api/dist/config.js';

// NFR-SEC-02: the app connects as erp_app, which (unlike Neon's owner role) cannot bypass row-level
// security. Neon's own DATABASE_URL (owner) is only for migrations.
if (process.env.APP_DATABASE_URL) process.env.DATABASE_URL = process.env.APP_DATABASE_URL;

let server = null;

async function start() {
  const app = await createApp(loadConfig(), {}, {});
  await app.init();
  return app.getHttpAdapter().getInstance();
}

export default async function handler(req, res) {
  server ??= start().catch((e) => {
    server = null; // try again on the next request
    throw e;
  });
  const express = await server;
  return express(req, res);
}
