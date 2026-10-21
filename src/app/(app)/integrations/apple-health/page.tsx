import Link from "next/link";
import { headers } from "next/headers";
import { CreateTokenForm } from "@/components/TokenForms";
import { Notice, PageHead } from "@/components/ui";
import { listApiTokens } from "@/lib/auth/api-tokens";
import { getSyncStatus, listImportRuns } from "@/lib/ingest/sync-status";
import { METRICS } from "@/lib/metrics/catalog";
import { appContext, db } from "@/lib/server/context";
import { formatDateTime, formatRelative } from "@/lib/time";

export const metadata = { title: "Apple Health sync" };

const STATE_TEXT = {
  never: { label: "Not connected", tone: "warn", text: "No data has been received yet. Follow the setup below." },
  ok: { label: "Healthy", tone: "ok", text: "Data is arriving on schedule." },
  stale: { label: "Outdated", tone: "warn", text: "No successful sync within the expected window. The iPhone may be off the network, locked for a long time, or the automation may not be running." },
  failing: { label: "Failing", tone: "error", text: "Recent sync attempts reached Vigor but failed. See the error below." },
} as const;

export default async function AppleHealthPage() {
  const { settings, tz } = await appContext();
  const database = db();
  const status = getSyncStatus(database);
  const runs = listImportRuns(database, "health", 30);
  const tokens = listApiTokens(database).filter((t) => !t.revokedAt);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "vigor.local:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;
  const isLocalhost = /^(localhost|127\.|\[::1\])/.test(host);
  const st = STATE_TEXT[status.state];
  const client = status.clients[0];

  return (
    <>
      <PageHead
        title="Apple Health sync"
        sub="Health data reaches Vigor from your iPhone over your local network. Vigor never reads Apple Health directly."
      />

      <section className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Status</h2>
            <span className={`pill ${status.state}`}><span className="dot" />{st.label}</span>
          </div>
          <Notice tone={st.tone}><p>{st.text}</p></Notice>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Last successful sync</dt>
            <dd>{status.lastSuccessAt ? <>{formatDateTime(status.lastSuccessAt, tz)} <span className="faint">({formatRelative(status.lastSuccessAt)})</span></> : "never"}</dd>
            <dt>Last attempt</dt>
            <dd>{status.lastAttemptAt ? <>{formatDateTime(status.lastAttemptAt, tz)} <span className="faint">({formatRelative(status.lastAttemptAt)})</span></> : "never"}</dd>
            <dt>Target interval</dt>
            <dd>every {settings.syncIntervalMinutes} min · flagged stale after {status.staleAfterHours} h</dd>
            <dt>Last 24 hours</dt>
            <dd>{status.last24h.runs} syncs · {status.last24h.accepted.toLocaleString()} new · {status.last24h.updated.toLocaleString()} updated · {status.last24h.deleted.toLocaleString()} deleted · {status.last24h.rejected.toLocaleString()} rejected</dd>
            <dt>Failed attempts</dt>
            <dd>{status.failuresSinceSuccess} since last success</dd>
            {client && (
              <>
                <dt>iPhone queue</dt>
                <dd>
                  {client.pendingSamples ?? "?"} pending samples <span className="faint">(reported by {client.source} {formatRelative(client.reportedAt)})</span>
                  {client.lastError && <div className="small" style={{ color: "var(--bad)" }}>Phone reports: {client.lastError}</div>}
                </dd>
              </>
            )}
          </dl>
          {status.lastError && (
            <div style={{ marginTop: 12 }}>
              <Notice tone="error"><p><strong>Last error:</strong> {status.lastError}</p></Notice>
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            <strong>Retrying:</strong> syncs are started by the iPhone. Failed transmissions are retried automatically by the companion app (and by the next
            scheduled Shortcut run, whose overlapping window re-sends missed samples). Re-sending is always safe — duplicates are skipped. To retry now, tap
            <em> Sync now</em> in the companion app or run the Shortcut manually.
          </p>
        </div>

        <div className="card">
          <h2>Connection details</h2>
          <dl className="kv">
            <dt>Import endpoint</dt>
            <dd><code>POST {base}/api/v1/health/import</code></dd>
            <dt>Status endpoint</dt>
            <dd><code>GET {base}/api/v1/health/status</code></dd>
            <dt>Authentication</dt>
            <dd><code>Authorization: Bearer &lt;token&gt;</code> header</dd>
            <dt>Active tokens</dt>
            <dd>{tokens.length ? tokens.map((t) => `${t.name} (${t.tokenPrefix}…, last used ${t.lastUsedAt ? formatRelative(t.lastUsedAt) : "never"})`).join("; ") : "none"}</dd>
          </dl>
          {isLocalhost && (
            <div style={{ marginTop: 12 }}>
              <Notice tone="warn">
                <p>You are viewing Vigor via <code>{host}</code>, which your iPhone cannot reach. Use this computer’s LAN address (for example <code>http://192.168.1.20:3000</code>) or a local hostname instead — see step 1.</p>
              </Notice>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <h3>Create a token for your iPhone</h3>
            <CreateTokenForm />
            <p className="tiny faint" style={{ marginTop: 6 }}>Manage, rotate or revoke tokens in <Link href="/settings?tab=integrations">Settings → Integrations</Link>.</p>
          </div>
          <details className="disclosure" style={{ marginTop: 12 }}>
            <summary>Test the connection from a computer</summary>
            <pre><code>{`curl -s -H "Authorization: Bearer $VIGOR_TOKEN" \\
  ${base}/api/v1/health/status`}</code></pre>
            <p className="small muted">A JSON reply with <code>&quot;ok&quot;: true</code> means the address and token work.</p>
          </details>
        </div>
      </section>

      <section className="card section">
        <h2>How synchronisation works</h2>
        <div className="grid grid-2">
          <div>
            <h3>Recommended: Vigor Sync companion app</h3>
            <p className="small">
              A small iOS app (source in <code>ios/VigorSync</code>) reads HealthKit with <em>anchored queries</em>: each sync sends only samples added or
              deleted since the last acknowledged anchor, including HealthKit UUIDs, so retries are idempotent and deletions are mirrored. It registers
              for HealthKit background delivery (hourly) and background app refresh, and keeps unsent changes queued (the anchor advances only after Vigor
              confirms receipt).
            </p>
            <p className="small muted">
              Limitation: iOS decides when background work actually runs. Expect roughly hourly syncs while the phone is in use; fewer when it is locked
              (Health data is encrypted while locked), in Low Power Mode, or if Background App Refresh is off. Building it requires a Mac with Xcode.
            </p>
          </div>
          <div>
            <h3>Alternative: Apple Shortcuts</h3>
            <p className="small">
              No app to build. A Shortcut finds recent Health samples and POSTs them. Because Shortcuts does not expose sample identifiers, Vigor
              deduplicates by content and the Shortcut re-sends an overlapping window (e.g. the last 6 hours) on each run.
            </p>
            <p className="small muted">
              Limitation: Shortcuts personal automations have no “every hour” trigger. Hourly sync requires one <em>Time of Day</em> automation per hour
              (or fewer for a coarser schedule). Runs while the phone is locked can fail because Health data is unavailable; the next run catches up.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-2 section">
        <div className="card">
          <h2>Set up the companion app</h2>
          <ol className="steps">
            <li><strong>Find Vigor’s address.</strong> On the computer running Vigor, find its LAN IP (macOS: System Settings → Wi-Fi → Details; Linux: <code>ip addr</code>; Windows: <code>ipconfig</code>). The URL is <code>http://&lt;ip&gt;:3000</code> or your reverse-proxy HTTPS URL. Your iPhone must be on the same network.</li>
            <li><strong>Create a token</strong> with the form above and keep it ready to paste.</li>
            <li><strong>Build the app.</strong> On a Mac with Xcode 16+: <code>brew install xcodegen</code>, then in <code>ios/VigorSync</code> run <code>xcodegen generate</code>, open <code>VigorSync.xcodeproj</code>, choose your Team under Signing, and run it on your iPhone. See <code>docs/apple-health-sync.md</code>.</li>
            <li><strong>Connect.</strong> In the app enter the server URL and token, tap <em>Test connection</em>, then <em>Grant Health access</em> and allow the data types you want.</li>
            <li><strong>Backfill.</strong> Choose how many days of history to send initially (default 30) and tap <em>Sync now</em>. Large histories are sent in batches.</li>
            <li><strong>Keep it running.</strong> Enable Settings → General → Background App Refresh for Vigor Sync. Opening the app occasionally helps iOS schedule it.</li>
          </ol>
        </div>

        <div className="card">
          <h2>Set up an Apple Shortcut</h2>
          <ol className="steps">
            <li>
              <strong>Server address.</strong> Find the LAN IP as described on the left. In the Shortcut you will call <code>{isLocalhost ? "http://<ip>:3000" : base}/api/v1/health/import</code>.
            </li>
            <li>
              <strong>List the types once.</strong> Add a <em>Dictionary</em> <code>Types</code> mapping each Vigor key (e.g. <code>step_count</code>) to the Health
              type name exactly as the <em>Find Health Samples</em> picker shows it on your phone (e.g. <em>Steps</em>). See the type table below.
            </li>
            <li>
              <strong>One loop for all types.</strong> <em>Repeat with Each</em> key in <code>Types</code>: set <code>Key</code>, then <em>Find Health Samples</em> with
              Type = <code>Types[Key]</code>, <em>Start Date is in the last 6 hours</em>, no limit. Loop over the results and, with <em>Get Details of Health Sample</em>
              and <em>Format Date → ISO 8601</em>, build one <em>Dictionary</em> per sample: <code>type</code> = <code>Key</code>, <code>value</code> (Number) and
              <code>category</code> (Text) both = the sample’s Value, plus <code>unit</code>, <code>startAt</code>, <code>endAt</code>, <code>sourceName</code>, then
              <em>Add to Variable</em> <code>Samples</code>. The same row works for sleep (Vigor reads the stage label from <code>category</code>). If the search found
              anything, also add <code>{"{"}type: Key, startAt: 6 hours ago, endAt: now{"}"}</code> to <code>Windows</code>.
            </li>
            <li>
              <strong>Send it.</strong> Build one <em>Dictionary</em> <code>Body</code> with <code>schemaVersion</code> (Number 1), <code>source</code> (Text
              <code>apple-shortcuts</code>), <code>syncId</code> and <code>generatedAt</code> (Text: the current date as ISO 8601), <code>samples</code> (List →
              <code>Samples</code>) and <code>replaceWindows</code> (List → <code>Windows</code>). Put <code>Body</code> alone into a <em>Text</em> action
              (<code>BodyJSON</code>), then <em>Get Contents of URL</em>: Method <em>POST</em>, Headers <code>Authorization</code> = <code>Bearer &lt;token&gt;</code> and
              <code>Content-Type</code> = <code>application/json</code>, Request Body <em>File</em> → <code>BodyJSON</code>. Don&rsquo;t put <code>Body</code> into a
              single field of the <em>JSON</em> body type: that sends <code>{"{"}&quot;Body&quot;: …{"}"}</code> and fails with <code>source: Required</code>. Never put the
              token in the URL.
            </li>
            <li>
              <strong>Schedule.</strong> Shortcuts → Automation → <em>+</em> → <em>Time of Day</em> → choose a time, <em>Daily</em>, <em>Run Immediately</em>, and select the
              Shortcut. There is no hourly repeat: create one automation per hour you want (e.g. 07:00, 08:00 … 23:00). Optionally add a <em>Charger</em> automation —
              it runs while the phone is often unlocked.
            </li>
            <li>
              <strong>Test.</strong> Run the Shortcut manually and show the result of <em>Get Contents of URL</em> (<em>Quick Look</em>). You should see
              <code>&quot;ok&quot;: true</code> and a summary; this page’s status and history update immediately.
            </li>
            <li>
              <strong>Troubleshoot</strong> with the checklist below if the run fails.
            </li>
          </ol>
          <details className="disclosure" style={{ marginTop: 12 }}>
            <summary>Example request body (what one run actually sends)</summary>
            <p className="small muted">
              <code>POST {isLocalhost ? "http://<ip>:3000" : base}/api/v1/health/import</code>. Every sample is the same shape regardless of type — the
              Shortcut&rsquo;s dictionary always fills both <code>value</code> and <code>category</code> from the sample&rsquo;s Value, so for non-sleep types
              <code>category</code> arrives as a stray text copy of the number and is simply ignored. <code>replaceWindows</code> has one entry per type
              that returned at least one sample this run (types with none are left out of both, per step 3).
            </p>
            <pre><code>{`{
  "schemaVersion": 1,
  "source": "apple-shortcuts",
  "syncId": "2026-10-20T08:00:00+02:00",
  "generatedAt": "2026-10-20T08:00:00+02:00",
  "samples": [
    { "type": "step_count", "value": 842, "category": "842", "unit": "count",
      "startAt": "2026-10-20T07:00:00+02:00", "endAt": "2026-10-20T07:30:00+02:00", "sourceName": "Apple Watch" },
    { "type": "heart_rate", "value": 64, "category": "64", "unit": "count/min",
      "startAt": "2026-10-20T07:12:00+02:00", "endAt": "2026-10-20T07:12:00+02:00", "sourceName": "Apple Watch" },
    { "type": "body_mass", "value": 80.4, "category": "80.4", "unit": "kg",
      "startAt": "2026-10-20T07:05:00+02:00", "endAt": "2026-10-20T07:05:00+02:00", "sourceName": "Health Scale" },
    { "type": "sleep_analysis", "value": "Deep", "category": "Deep", "unit": "",
      "startAt": "2026-10-20T01:10:00+02:00", "endAt": "2026-10-20T02:05:00+02:00", "sourceName": "Apple Watch" },
    { "type": "dietary_protein", "value": 32, "category": "32", "unit": "g",
      "startAt": "2026-10-20T07:40:00+02:00", "endAt": "2026-10-20T07:40:00+02:00", "sourceName": "MyFitnessPal" }
  ],
  "replaceWindows": [
    { "type": "step_count", "startAt": "2026-10-20T02:00:00+02:00", "endAt": "2026-10-20T08:00:00+02:00" },
    { "type": "heart_rate", "startAt": "2026-10-20T02:00:00+02:00", "endAt": "2026-10-20T08:00:00+02:00" },
    { "type": "body_mass", "startAt": "2026-10-20T02:00:00+02:00", "endAt": "2026-10-20T08:00:00+02:00" },
    { "type": "sleep_analysis", "startAt": "2026-10-20T02:00:00+02:00", "endAt": "2026-10-20T08:00:00+02:00" },
    { "type": "dietary_protein", "startAt": "2026-10-20T02:00:00+02:00", "endAt": "2026-10-20T08:00:00+02:00" }
  ]
}`}</code></pre>
            <p className="tiny faint">
              <code>sleep_analysis</code>&rsquo;s stage label lands in both fields too; Vigor reads <code>category</code> for sleep and ignores <code>value</code>
              there. Validated against the import pipeline: 5 received, 5 accepted, 0 rejected.
            </p>
          </details>
          <details className="disclosure" style={{ marginTop: 8 }}>
            <summary>Alternative: querying &ldquo;today&rdquo; instead of a rolling window</summary>
            <p className="small muted">
              If the Shortcut&rsquo;s <em>Find Health Samples</em> filter is <em>Start Date is today</em> rather than <em>in the last 6 hours</em>, drop
              <code>replaceWindows</code> and <code>Windows</code> entirely and add <code>replaceToday: true</code> instead. Vigor then builds the replace
              window itself — local midnight (by <code>generatedAt</code>&rsquo;s own offset) through <code>generatedAt</code> — for every type that
              returned a sample, exactly like the per-type <code>Windows</code> entries above, without the Shortcut having to build them. This run
              (an evening sync) sends the whole day so far for each type:
            </p>
            <pre><code>{`{
  "schemaVersion": 1,
  "source": "apple-shortcuts",
  "syncId": "2026-10-21T20:15:00+02:00",
  "generatedAt": "2026-10-21T20:15:00+02:00",
  "samples": [
    { "type": "step_count", "value": 9480, "category": "9480", "unit": "count",
      "startAt": "2026-10-21T00:00:00+02:00", "endAt": "2026-10-21T20:15:00+02:00", "sourceName": "Apple Watch" },
    { "type": "body_mass", "value": 80.4, "category": "80.4", "unit": "kg",
      "startAt": "2026-10-21T07:05:00+02:00", "endAt": "2026-10-21T07:05:00+02:00", "sourceName": "Health Scale" },
    { "type": "dietary_protein", "value": 96, "category": "96", "unit": "g",
      "startAt": "2026-10-21T19:40:00+02:00", "endAt": "2026-10-21T19:40:00+02:00", "sourceName": "MyFitnessPal" }
  ],
  "replaceToday": true
}`}</code></pre>
            <p className="tiny faint">
              No <code>replaceWindows</code> key at all — that is what tells Vigor to infer one from <code>replaceToday</code>. If
              <code>replaceWindows</code> is present, even for just one type, <code>replaceToday</code> is ignored for all of them. Validated against
              the import pipeline: 3 received, 3 accepted, 0 rejected. Details: <code>docs/apple-health-shortcuts.md</code> and <code>docs/import-api.md</code>.
            </p>
          </details>
          <p className="small muted" style={{ marginTop: 10 }}>A complete walkthrough is in <code>docs/apple-health-shortcuts.md</code>.</p>
        </div>
      </section>

      <section className="card section">
        <h2>Troubleshooting</h2>
        <details className="disclosure">
          <summary>“Could not connect to the server” / timeout</summary>
          <ul className="small">
            <li>The iPhone must be on the same Wi-Fi/LAN as Vigor (not on cellular, not on a guest network with client isolation).</li>
            <li>Use the LAN IP or hostname, never <code>localhost</code>. Check the port (default 3000) and that the host firewall allows it.</li>
            <li>iOS asks for <em>Local Network</em> permission the first time the companion app connects — allow it (Settings → Privacy &amp; Security → Local Network).</li>
            <li>Plain <code>http://</code> works on a LAN; if you use HTTPS through a reverse proxy, the certificate must be trusted by the iPhone.</li>
          </ul>
        </details>
        <details className="disclosure">
          <summary>401 Unauthorized</summary>
          <ul className="small">
            <li>The header must be exactly <code>Authorization: Bearer vgr_…</code> — check for missing “Bearer ”, extra spaces or line breaks.</li>
            <li>The token may have been revoked or rotated. Create a new one above.</li>
            <li>After 30 failed attempts per minute Vigor answers 429 for a minute.</li>
          </ul>
        </details>
        <details className="disclosure">
          <summary>400 / 422 — payload rejected</summary>
          <ul className="small">
            <li>The body must be JSON with <code>schemaVersion: 1</code>, <code>source</code>, <code>syncId</code>, <code>generatedAt</code>. The history below shows the exact validation messages.</li>
            <li>Timestamps must include a time-zone offset (ISO 8601, e.g. <code>2026-10-20T08:00:00+02:00</code>).</li>
            <li>Individual samples with unknown types or units are rejected individually; the rest of the batch is stored (status “partial”).</li>
            <li>413 means the request exceeded the size limit — shorten the window or send fewer types per run.</li>
          </ul>
        </details>
        <details className="disclosure">
          <summary>Sync succeeds but some data is missing</summary>
          <ul className="small">
            <li>Check Health permissions: Settings → Health → Data Access &amp; Devices → Vigor Sync / Shortcuts → allow every type.</li>
            <li>Health data is unavailable while the iPhone is locked; runs at night may send nothing. The overlapping window / anchors catch up later.</li>
            <li>Apps that don’t write to Apple Health (or only some fields) can’t appear in Vigor. Check the source app’s Health settings.</li>
            <li>Missing days are displayed as “no data”, never as zero.</li>
          </ul>
        </details>
        <details className="disclosure">
          <summary>Data stopped updating (stale)</summary>
          <ul className="small">
            <li>Companion app: make sure Background App Refresh is on, Low Power Mode is off, and open the app once — iOS deprioritises apps that are never opened.</li>
            <li>Shortcuts: check Automation → each automation is enabled and set to Run Immediately.</li>
            <li>The phone may simply have been away from home; data syncs when it is back on the network.</li>
          </ul>
        </details>
      </section>

      <section className="card section">
        <h2>Import history</h2>
        {runs.length === 0 ? <p className="muted">No sync attempts yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Source</th><th>Status</th><th className="r">Received</th><th className="r">New</th><th className="r">Updated</th><th className="r">Skipped</th><th className="r">Deleted</th><th className="r">Rejected</th><th>Details</th></tr></thead>
              <tbody>
                {runs.map((r) => {
                  const details = r.details ? (JSON.parse(r.details) as { rejections?: { kind: string; index: number; reason: string }[]; issues?: string[] }) : {};
                  const problems = [...(details.issues ?? []), ...(details.rejections ?? []).map((x) => `${x.kind} #${x.index}: ${x.reason}`)];
                  return (
                    <tr key={r.id}>
                      <td className="small">{formatDateTime(r.startedAt, tz)}</td>
                      <td className="small muted">{r.source}</td>
                      <td><span className={`pill ${r.status === "success" ? "ok" : r.status === "partial" ? "stale" : "failing"}`}><span className="dot" />{r.status}</span></td>
                      <td className="r num">{r.received}</td>
                      <td className="r num">{r.accepted}</td>
                      <td className="r num">{r.updated}</td>
                      <td className="r num">{r.skipped}</td>
                      <td className="r num">{r.deleted}</td>
                      <td className="r num">{r.rejected}</td>
                      <td className="small">
                        {r.error && <div style={{ color: "var(--bad)" }}>{r.error}</div>}
                        {problems.length > 0 && (
                          <details>
                            <summary className="muted">{problems.length} issue{problems.length > 1 ? "s" : ""}</summary>
                            <ul className="tiny">{problems.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}</ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-2 section">
        <div className="card">
          <h2>Supported types</h2>
          <p className="small muted">Use the Vigor key as <code>type</code>. Any unit listed in <code>docs/import-api.md</code> is converted automatically.</p>
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Vigor key</th><th>Apple Health</th><th>Unit</th></tr></thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.key}><td><code>{m.key}</code></td><td className="small">{m.label}</td><td className="small muted">{m.unit}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Sync checkpoints</h2>
          <p className="small muted">Incremental cursors (HealthKit anchors) acknowledged per source and type. A reinstalled companion app restores them from here.</p>
          {status.cursors.length === 0 ? <p className="small faint">No cursors stored (Shortcuts uses time windows instead).</p> : (
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Source</th><th>Scope</th><th>Updated</th></tr></thead>
                <tbody>
                  {status.cursors.map((c) => (
                    <tr key={c.source + c.scope}><td className="small">{c.source}</td><td className="small"><code>{c.scope}</code></td><td className="small muted">{formatRelative(c.updatedAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
