// FR-SET-05: one database backup now (the API also makes one every day).
// Usage: npm run db:backup --workspace @erp/api
import { BackupService } from './backup/backup.service.js';
import { loadConfig } from './config.js';

const svc = new BackupService(loadConfig());
const f = await svc.backup();
console.log(`saved ${svc.dir}/${f.name} (${Math.round(f.bytes / 1024)} KB)`);
