import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.PORT, config.HOST);
console.log(`API on http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}/api`);
