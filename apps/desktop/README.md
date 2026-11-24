# Shop ERP for Windows (desktop app)

One installer for Windows 10/11 (64-bit) with the whole system inside: the app window, its server,
and its own PostgreSQL 18 database. All shop data stays on the PC. Internet is only needed for AI
bill reading.

## Build the installer (on the development PC)

```bash
npm run installer --workspace @erp/desktop
```

Output: `apps/desktop/dist/Shop ERP Setup <version>.exe` (about 185 MB). The build ends with a
self-check that loads the packaged server; if anything is missing the build fails.
Needs PostgreSQL 18 installed on the build PC (its `pg_dump.exe` / `pg_restore.exe` are bundled for
backups; set `PG_BIN` if they are not in `C:\Program Files\PostgreSQL\18\bin`). Close any running dev
copy first (it keeps a database engine file open).

Try it without installing: `npm start --workspace @erp/desktop` (uses the `Shop ERP Dev` data folder).

## On the client's PC

1. Run `Shop ERP Setup <version>.exe`. The installer is not code-signed yet, so Windows SmartScreen may
   say "Windows protected your PC": click **More info → Run anyway**.
2. First start (about a minute, later starts about 10 s): the **first-time setup** screen asks for
   the shop name and the owner's phone and password. It works only on that PC and only once.
3. Allow **Shop ERP** through Windows Firewall on **private networks** when Windows asks; that lets
   phones on the shop's Wi-Fi open the app (Help → Connect a phone shows the address, for example
   `http://192.168.1.4:3000/`).

## Where things are

| What | Where |
|---|---|
| Program | `%LOCALAPPDATA%\Programs\Shop ERP` |
| Data (database, photos, backups, logs) | `%APPDATA%\Shop ERP` |
| Daily backups (14 kept) | `%APPDATA%\Shop ERP\backups` (File → Open backups folder) |
| Log for support | `%APPDATA%\Shop ERP\logs\app.log` (Help → Open log file) |
| Secrets (generated on first run) | `%APPDATA%\Shop ERP\config.json` |
| Optional QSSols AI key | `%APPDATA%\Shop ERP\ai.env` (`HOSTED_AI_PROVIDER=openai` and `OPENAI_API_KEY=…`), or the shop's own key in the app's AI settings |

Uninstalling keeps the data folder. Copy the `backups` folder to a USB drive regularly; a backup is
restored with `pg_restore --clean --if-exists --no-owner -d <database> <file>`.

## How it works

- `src/main.js` (Electron main process): single instance; starts PostgreSQL (`embedded-postgres`,
  127.0.0.1 only, UTC, scram passwords) and creates `shop_erp` plus the `erp_app` role (no BYPASSRLS,
  so row-level security applies) on first run; applies migrations with the bundled Prisma CLI; starts
  the API (`apps/api/dist/main.js`, run by Electron as Node) on port 3000 (or the next free port)
  with `SETUP_ENABLED=true`; shows it in a window. Closing the app stops the server and then the
  database cleanly with `pg_ctl stop -m fast` (also when Windows shuts down).
- `scripts/build-installer.mjs` assembles `build/app` (compiled code, migrations, production
  `node_modules`, the hidden `.prisma` client via `extraResources`, pg_dump/pg_restore, icon) and runs
  electron-builder (`electron-builder.json`, NSIS, per-user, no asar).
