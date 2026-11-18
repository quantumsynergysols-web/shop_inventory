import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Requires, type AuthUser } from '../auth/decorators.js';
import { BackupService } from './backup.service.js';
import { ExportService } from './export.service.js';

@Controller()
export class BackupController {
  constructor(
    private readonly exporter: ExportService,
    private readonly backups: BackupService,
  ) {}

  /** FR-SET-05: the owner downloads everything of the shop: Excel + bill photos, one zip. */
  @Requires('data.export')
  @Get('export')
  async export(@CurrentUser() u: AuthUser, @Res() res: Response) {
    const { filename, zip } = await this.exporter.build(u);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }).pipe(res);
  }

  /** FR-SET-05: when the last automatic backup ran (no file names or paths leave the server). */
  @Requires('settings.manage')
  @Get('backup/status')
  async status() {
    const s = await this.backups.status();
    return { enabled: s.enabled, lastAt: s.last?.at ?? null, lastBytes: s.last?.bytes ?? null, lastError: s.lastError ? 'The last backup failed; the server log has the reason' : null, nextAt: s.nextAt, keep: s.keep };
  }
}
