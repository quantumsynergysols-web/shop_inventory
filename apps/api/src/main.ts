import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.PORT);
console.log(`API on http://localhost:${config.PORT}/api`);
