import Link from "next/link";
import type { SyncStatus } from "@/lib/ingest/sync-status";
import { formatRelative } from "@/lib/time";

const LABEL: Record<SyncStatus["state"], string> = {
  never: "Apple Health not connected",
  ok: "Synced",
  stale: "Sync outdated",
  failing: "Sync failing",
};

export function SyncPill({ status }: { status: SyncStatus }) {
  const when = status.lastSuccessAt ? formatRelative(status.lastSuccessAt) : null;
  const title =
    status.state === "stale"
      ? `No successful sync for more than ${status.staleAfterHours} h — imported data may be outdated.`
      : status.lastError ?? undefined;
  return (
    <Link href="/integrations/apple-health" className={`pill ${status.state}`} title={title}>
      <span className="dot" />
      {LABEL[status.state]}
      {when && <span className="faint">· {when}</span>}
    </Link>
  );
}
