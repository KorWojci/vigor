# Security and privacy

Health and fitness data is sensitive. These are Vigor's protections, its assumptions, and what remains your responsibility.

## Data stays with you

- All records live in one SQLite file in the data directory on your hardware. There is no cloud component.
- **No outbound requests:** no analytics, telemetry, error reporting, CDNs or web fonts. Next.js telemetry is disabled (`NEXT_TELEMETRY_DISABLED=1`). Charts render locally.
- The iPhone companion talks only to the server URL you enter.
- Tests, screenshots, samples and example configuration use **synthetic data only**. Demo data is labelled `demo`/`SYNTHETIC` and can be removed in one click.

## Authentication

| Surface | Mechanism |
| --- | --- |
| Web UI and server actions | Username and password. Password hashed with scrypt (N=2¹⁵, r=8, p=1, 16-byte salt). Session cookie: random 256-bit token, `HttpOnly`, `SameSite=Lax`, `Secure` when `VIGOR_SECURE_COOKIES=true`, 30-day expiry. The database stores only its SHA-256. Every page and action re-validates the session server-side. Changing the password revokes all sessions. |
| Import and status API | Separate **ingestion tokens** (`vgr_` + 256 random bits), sent only as `Authorization: Bearer`. Stored as SHA-256; shown once at creation; revocable and rotatable; last-used time recorded. They are scoped to `health:import` and cannot read data through the UI. |
| Export and backup downloads | Session required. Backup names are validated against a strict pattern (no path traversal). |
| Health check | Public; returns only `ok` and the schema version. |

Brute-force protection: 8 failed logins per 15 minutes per client IP, and 30 failed token attempts per minute per IP (in memory; resets on restart).

## Input handling

- The import API validates the envelope with zod, then each record individually: types, units, ranges, timestamps with explicit offsets, and string lengths.
- Request bodies are size-limited while streaming (`VIGOR_MAX_IMPORT_BYTES`, default 10 MiB), even without `Content-Length`. Hevy uploads are capped at 20 MB.
- All SQL uses bound parameters. Table names are never derived from input.
- Restore validates uploads (SQLite header, integrity check, schema version) before swapping files.
- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`. The `X-Powered-By` header is disabled.

## Logging

Logs are structured JSON lines on stdout. They contain event names, counts and ids, **never** request bodies, health values or credentials. A redaction filter also strips `Bearer …` and `vgr_…` strings from any log line. Authorization headers are never logged.

## Secrets in the repository

`.gitignore` excludes `.env*` (except `.env.example`), `data/`, databases (`*.db`, `*.sqlite`, WAL files), backups, exports, CSV files outside `samples/`, `export.xml`/`export.zip`, logs and certificates. `.env.example` contains placeholders only. The demo password used in development docs is obviously synthetic.

## Local-network assumptions and limitations

- Vigor is designed for a **trusted home network**. Plain HTTP on the LAN means anyone who can sniff your Wi-Fi could read traffic, including tokens and health data. Use WPA2/WPA3, avoid untrusted networks, and prefer HTTPS through a reverse proxy where practical.
- **Do not expose Vigor directly to the internet.** Use a VPN, or a TLS reverse proxy with an additional authentication layer.
- Vigor is single-user. Anyone with the password sees everything.
- The database file is not encrypted at rest. Protect the host and volume with full-disk encryption, and encrypt backups.
- Rate limits are per process and reset on restart.
- The iPhone companion stores its token in the Keychain (`AfterFirstUnlockThisDeviceOnly`), which background sync needs. Anyone who can unlock the phone can use the app.
- A Shortcut stores its token inside the shortcut. Don't share that shortcut.

## Your rights over the data

- **Export:** Settings → Data → JSON export.
- **Delete:** Settings → Data → permanently delete health data (optionally by source), workouts, measurements, import history, or everything. Deleted rows are removed from the database, and the WAL is checkpointed. Backups you created are separate files; delete them too if needed.
- **Revoke access:** revoke ingestion tokens; change the password, which signs out all sessions.

## Reporting a vulnerability

Please open a private security advisory on the repository rather than a public issue.
