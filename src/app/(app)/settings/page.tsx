import Link from "next/link";
import { RotateTokenButton, CreateTokenForm } from "@/components/TokenForms";
import { FlashMessage, Notice, PageHead, Tabs } from "@/components/ui";
import { listApiTokens } from "@/lib/auth/api-tokens";
import { listBackups, storageStats } from "@/lib/data/manage";
import { formatBytes } from "@/lib/format";
import { getSyncStatus, listImportRuns } from "@/lib/ingest/sync-status";
import { appContext, db } from "@/lib/server/context";
import { DashboardEditor } from "@/components/DashboardEditor";
import { getDashboardLayout } from "@/lib/settings";
import { formatDateTime, formatRelative, RANGE_PRESETS } from "@/lib/time";
import { EXERCISE_KINDS } from "@/lib/training/calculations";
import { listExercises } from "@/lib/training/repo";
import {
  changePasswordAction,
  createBackupAction,
  deleteBackupAction,
  deleteDataAction,
  demoDataAction,
  importHevyAction,
  mergeExercisesAction,
  restoreBackupAction,
  revokeTokenAction,
  saveAppSettingsAction,
  saveMetricsSettingsAction,
  saveProfileAction,
  saveSyncSettingsAction,
} from "./actions";

export const metadata = { title: "Settings" };

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "metrics", label: "Metrics" },
  { key: "integrations", label: "Integrations" },
  { key: "training", label: "Training imports" },
  { key: "data", label: "Data" },
  { key: "app", label: "Application" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await appContext();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "profile";
  return (
    <>
      <PageHead title="Settings" sub="Personal details, preferences, integrations and your data." />
      <Tabs current={tab} tabs={TABS.map((t) => ({ ...t, href: `/settings?tab=${t.key}` }))} />
      <FlashMessage searchParams={sp} />
      {tab === "profile" && <ProfileTab ctx={ctx} />}
      {tab === "metrics" && <MetricsTab ctx={ctx} />}
      {tab === "integrations" && <IntegrationsTab ctx={ctx} />}
      {tab === "training" && <TrainingTab ctx={ctx} />}
      {tab === "data" && <DataTab ctx={ctx} />}
      {tab === "app" && <AppTab ctx={ctx} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof appContext>>;

function ProfileTab({ ctx }: { ctx: Ctx }) {
  const p = ctx.settings.profile;
  return (
    <div className="grid grid-2">
      <form action={saveProfileAction} className="card form">
        <h2>Personal profile</h2>
        <label className="field"><span>Display name <span className="hint">(optional, shown on the dashboard)</span></span><input name="displayName" defaultValue={p.displayName ?? ""} maxLength={80} /></label>
        <div className="form-row">
          <label className="field"><span>Birth year <span className="hint">(optional)</span></span><input name="birthYear" type="number" min={1900} max={2100} defaultValue={p.birthYear ?? ""} /></label>
          <label className="field">
            <span>Sex <span className="hint">(optional)</span></span>
            <select name="sex" defaultValue={p.sex ?? "unspecified"}>
              <option value="unspecified">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Units</span>
          <select name="units" defaultValue={ctx.settings.units}>
            <option value="metric">Metric (kg, cm, km, °C)</option>
            <option value="imperial">Imperial (lb, in, mi, °F)</option>
          </select>
          <span className="hint">Data is always stored in metric units; this only changes display and entry.</span>
        </label>
        <p className="small muted">Height is recorded as a body measurement (or synced from Apple Health) so its history is kept — <Link href="/body?type=height">add height</Link>.</p>
        <div><button className="btn primary">Save profile</button></div>
      </form>
      <form action={changePasswordAction} className="card form">
        <h2>Password</h2>
        <p className="small muted">Signed in as <strong>{ctx.user.username}</strong>. Changing the password signs out every session.</p>
        <label className="field"><span>Current password</span><input name="current" type="password" autoComplete="current-password" required /></label>
        <label className="field"><span>New password</span><input name="next" type="password" autoComplete="new-password" minLength={10} required /></label>
        <label className="field"><span>Confirm new password</span><input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
        <div><button className="btn">Change password</button></div>
      </form>
    </div>
  );
}

function MetricsTab({ ctx }: { ctx: Ctx }) {
  return (
    <div className="stack">
      <DashboardEditor initial={getDashboardLayout(db())} returnTo="/settings?tab=metrics" />
      <div className="grid grid-2">
        <form action={saveMetricsSettingsAction} className="card form">
          <h2>Charts</h2>
          <label className="field">
            <span>Moving average on metric charts</span>
            <select name="movingAverageDays" defaultValue={String(ctx.settings.movingAverageDays)}>
              <option value="0">Off</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option>
            </select>
          </label>
          <div><button className="btn primary">Save</button></div>
        </form>
        <div className="card">
          <h2>Measurement definitions</h2>
          <p className="small">Built-in body measurements cover height, weight, body fat, lean mass, neck, shoulders, chest, waist, hips and both arms, forearms, thighs and calves. Each is linked to a region of the dashboard figure.</p>
          <p className="small">Add your own (e.g. wrist, ankle) on the <Link href="/body">Body measurements</Link> page.</p>
          <p className="small muted">Health metric types and their aggregation rules are defined in <code>src/lib/metrics/catalog.ts</code>; see <code>docs/architecture.md</code> to add a new type.</p>
        </div>
      </div>
    </div>
  );
}

function IntegrationsTab({ ctx }: { ctx: Ctx }) {
  const database = db();
  const tokens = listApiTokens(database);
  const status = getSyncStatus(database);
  return (
    <div className="stack">
      <div className="grid grid-2">
        <div className="card">
          <h2>Apple Health</h2>
          <dl className="kv">
            <dt>Architecture</dt><dd>Vigor Sync companion app (recommended) or Apple Shortcuts — both push to the import API</dd>
            <dt>Status</dt><dd><span className={`pill ${status.state}`}><span className="dot" />{status.state}</span></dd>
            <dt>Last successful sync</dt><dd>{status.lastSuccessAt ? `${formatDateTime(status.lastSuccessAt, ctx.tz)} (${formatRelative(status.lastSuccessAt)})` : "never"}</dd>
            <dt>Endpoint</dt><dd><code>POST /api/v1/health/import</code></dd>
          </dl>
          <p className="small" style={{ marginTop: 10 }}><Link href="/integrations/apple-health">Setup guide, import history and diagnostics →</Link></p>
        </div>
        <form action={saveSyncSettingsAction} className="card form">
          <h2>Synchronisation frequency</h2>
          <label className="field">
            <span>Target interval (minutes)</span>
            <input name="syncIntervalMinutes" type="number" min={15} max={1440} defaultValue={ctx.settings.syncIntervalMinutes} />
            <span className="hint">Shown on the dashboard and returned to the companion app. iOS decides the actual run times. Data is flagged stale after {status.staleAfterHours} h (env <code>VIGOR_STALE_AFTER_HOURS</code>).</span>
          </label>
          <div><button className="btn">Save</button></div>
        </form>
      </div>
      <div className="card">
        <h2>Ingestion tokens</h2>
        <p className="small muted">Each iPhone (or Shortcut) authenticates with its own token. Tokens are stored as SHA-256 hashes and shown only once. Revoke a token if a phone is lost.</p>
        <CreateTokenForm />
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tokens.length === 0 && <tr><td colSpan={6} className="muted">No tokens yet.</td></tr>}
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td><code>{t.tokenPrefix}…</code></td>
                  <td className="small muted">{formatDateTime(t.createdAt, ctx.tz)}</td>
                  <td className="small muted">{t.lastUsedAt ? formatRelative(t.lastUsedAt) : "never"}</td>
                  <td>{t.revokedAt ? <span className="pill failing"><span className="dot" />revoked</span> : <span className="pill ok"><span className="dot" />active</span>}</td>
                  <td className="r">
                    {!t.revokedAt && (
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <RotateTokenButton id={t.id} />
                        <form action={revokeTokenAction}><input type="hidden" name="id" value={t.id} /><button className="btn small danger">Revoke</button></form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TrainingTab({ ctx }: { ctx: Ctx }) {
  const database = db();
  const runs = listImportRuns(database, "hevy", 15);
  const exercises = listExercises(database);
  return (
    <div className="stack">
      <div className="grid grid-2">
        <form action={importHevyAction} className="card form">
          <h2>Import from Hevy</h2>
          <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>In Hevy: <em>Profile → Settings (gear) → Export &amp; Import Data → Export Data → Export Workouts</em>.</li>
            <li>Save the CSV file (AirDrop, Files or email it to the device you use for Vigor).</li>
            <li>Upload it here. Re-importing a newer export is safe: existing workouts are matched and updated, never duplicated.</li>
          </ol>
          <label className="field"><span>Hevy workouts CSV</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
          <label className="check"><input type="checkbox" name="removeMissing" /> Remove Hevy workouts that are not in this export (use only with a complete export)</label>
          <p className="tiny faint">Times in the export have no time zone; they are interpreted in {ctx.tz}. Vigor never asks for your Hevy password.</p>
          <div><button className="btn primary">Import</button></div>
        </form>
        <form action={mergeExercisesAction} className="card form">
          <h2>Exercise matching</h2>
          <p className="small muted">If the same exercise appears under two names (e.g. after renaming it in Hevy), merge them. History moves to the exercise you keep and the old name becomes an alias for future imports.</p>
          <label className="field">
            <span>Merge this exercise…</span>
            <select name="source" required>{exercises.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.sessions})</option>)}</select>
          </label>
          <label className="field">
            <span>…into this one (kept)</span>
            <select name="target" required>{exercises.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.sessions})</option>)}</select>
          </label>
          <div><button className="btn" disabled={exercises.length < 2}>Merge</button></div>
          <p className="tiny faint">Exercise types ({EXERCISE_KINDS.map((k) => k.label.toLowerCase()).join(", ")}) can be changed on each exercise’s page.</p>
        </form>
      </div>
      <div className="card">
        <h2>Import history</h2>
        {runs.length === 0 ? <p className="muted small">No Hevy imports yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>File</th><th>Status</th><th className="r">Workouts</th><th className="r">New</th><th className="r">Updated</th><th className="r">Unchanged</th><th className="r">Removed</th><th className="r">Rejected rows</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{formatDateTime(r.startedAt, ctx.tz)}</td>
                    <td className="small muted">{r.syncId}</td>
                    <td><span className={`pill ${r.status === "success" ? "ok" : r.status === "partial" ? "stale" : "failing"}`}><span className="dot" />{r.status}</span>{r.error && <div className="tiny" style={{ color: "var(--bad)" }}>{r.error}</div>}</td>
                    <td className="r num">{r.received}</td><td className="r num">{r.accepted}</td><td className="r num">{r.updated}</td><td className="r num">{r.skipped}</td><td className="r num">{r.deleted}</td><td className="r num">{r.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DataTab({ ctx }: { ctx: Ctx }) {
  const database = db();
  const stats = storageStats(database);
  const backups = listBackups();
  const sources = database.prepare("SELECT DISTINCT source FROM health_samples ORDER BY source").all() as { source: string }[];
  const hasDemo = database.prepare("SELECT 1 FROM health_samples WHERE source = 'demo' LIMIT 1").get();
  return (
    <div className="stack">
      <div className="grid grid-2">
        <div className="card">
          <h2>Stored data</h2>
          <table>
            <tbody>
              {Object.entries(stats.counts).map(([k, v]) => <tr key={k}><td>{k}</td><td className="r num">{v.toLocaleString()}</td></tr>)}
              <tr><td>Database size</td><td className="r num">{formatBytes(stats.dbBytes)}</td></tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 10 }}>Deleted samples are kept as tombstones so a late re-send of a deleted sample is recognised. They are removed with “Delete health data”.</p>
        </div>
        <div className="card">
          <h2>Export</h2>
          <p className="small">Download everything (health samples, workouts, sets, measurements, settings, import history) as JSON. Passwords and token hashes are not included.</p>
          <a className="btn primary" href="/api/data/export">Download JSON export</a>
          <h3 style={{ marginTop: 18 }}>Demonstration data</h3>
          <p className="small muted">Synthetic sample data for exploring Vigor. It is labelled “demo”/“SYNTHETIC” everywhere and can be removed at any time.</p>
          <form action={demoDataAction} className="row">
            <input type="hidden" name="op" value={hasDemo ? "remove" : "load"} />
            <button className="btn">{hasDemo ? "Remove demo data" : "Load demo data"}</button>
          </form>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Backups</h2>
          <p className="small">Backups are consistent SQLite snapshots written to <code>&lt;data dir&gt;/backups</code>. Copy them off the server for real protection.</p>
          <form action={createBackupAction}><button className="btn primary">Create backup now</button></form>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <tbody>
                {backups.length === 0 && <tr><td className="muted small">No backups yet.</td></tr>}
                {backups.map((b) => (
                  <tr key={b.name}>
                    <td className="small"><a href={`/api/data/backups/${b.name}`}>{b.name}</a></td>
                    <td className="small muted">{formatBytes(b.bytes)}</td>
                    <td className="small muted">{formatDateTime(b.createdAt, ctx.tz)}</td>
                    <td className="r"><form action={deleteBackupAction}><input type="hidden" name="name" value={b.name} /><button className="btn small danger">Delete</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <form action={restoreBackupAction} className="card form">
          <h2>Restore</h2>
          <Notice tone="warn"><p className="small">Restoring replaces <strong>all</strong> current data with the backup, including accounts. A safety backup of the current database is made first. You will be signed out.</p></Notice>
          <label className="field"><span>Backup file (.db)</span><input type="file" name="file" accept=".db,application/vnd.sqlite3,application/octet-stream" required /></label>
          <label className="field"><span>Type RESTORE to confirm</span><input name="confirm" autoComplete="off" required /></label>
          <div><button className="btn danger">Restore backup</button></div>
        </form>
      </div>

      <form action={deleteDataAction} className="card form">
        <h2>Permanently delete data</h2>
        <p className="small muted">Deletion cannot be undone. Consider creating a backup first. A sync source may send the same records again unless you also stop it.</p>
        <div className="form-row">
          <label className="field">
            <span>What to delete</span>
            <select name="scope" defaultValue="health">
              <option value="health">Imported health data (samples, Apple Health workouts, sync cursors)</option>
              <option value="workouts">Workouts and exercise history</option>
              <option value="measurements">Manual body measurements and custom types</option>
              <option value="imports">Import and sync history</option>
              <option value="everything">Everything (keeps only your login)</option>
            </select>
          </label>
          <label className="field">
            <span>Limit to source <span className="hint">(optional, health/workouts)</span></span>
            <select name="source" defaultValue="">
              <option value="">All sources</option>
              {sources.map((s) => <option key={s.source} value={s.source}>{s.source}</option>)}
              <option value="hevy">hevy</option>
            </select>
          </label>
          <label className="field"><span>Type DELETE to confirm</span><input name="confirm" autoComplete="off" required /></label>
        </div>
        <div><button className="btn danger">Delete permanently</button></div>
      </form>
    </div>
  );
}

function AppTab({ ctx }: { ctx: Ctx }) {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return (
    <form action={saveAppSettingsAction} className="card form" style={{ maxWidth: 640 }}>
      <h2>Application</h2>
      <label className="field">
        <span>Time zone</span>
        <input name="timezone" list="tz-list" defaultValue={ctx.settings.timezone} required />
        <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
        <span className="hint">Days, nights and weekly totals are computed in this zone. Hevy export times are interpreted in it.</span>
      </label>
      <label className="field">
        <span>Theme</span>
        <select name="theme" defaultValue={ctx.settings.theme}>
          <option value="system">Follow the device</option><option value="light">Parchment (light)</option><option value="dark">Charcoal (dark)</option>
        </select>
      </label>
      <label className="field">
        <span>Default date range</span>
        <select name="defaultRange" defaultValue={ctx.settings.defaultRange}>
          {RANGE_PRESETS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>
      <div><button className="btn primary">Save</button></div>
      <p className="tiny faint">Vigor makes no external network requests: no analytics, telemetry, web fonts or CDNs.</p>
    </form>
  );
}
