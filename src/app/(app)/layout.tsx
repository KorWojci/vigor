import Link from "next/link";
import { Nav } from "@/components/Nav";
import { SyncPill } from "@/components/SyncPill";
import { VigorMark } from "@/components/VitruvianFigure";
import { getSyncStatus } from "@/lib/ingest/sync-status";
import { db, requireUser } from "@/lib/server/context";
import { logoutAction } from "../auth-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const status = getSyncStatus(db());
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <VigorMark size={30} />
          <span className="brand-name">Vigor</span>
        </Link>
        <Nav />
        <div className="sidebar-foot">
          <SyncPill status={status} />
          <form action={logoutAction} className="row small muted">
            <span>{user.username}</span>
            <button className="btn small" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="topbar">
        <Link href="/" className="brand">
          <VigorMark size={24} />
          <span className="brand-name" style={{ fontSize: "1.1rem" }}>Vigor</span>
        </Link>
        <div className="row">
          <SyncPill status={status} />
          <details>
            <summary aria-label="Menu">☰</summary>
            <Nav />
            <form action={logoutAction} style={{ marginTop: 8 }}>
              <button className="btn small" type="submit">Sign out</button>
            </form>
          </details>
        </div>
      </div>
      <main className="main">{children}</main>
    </div>
  );
}
