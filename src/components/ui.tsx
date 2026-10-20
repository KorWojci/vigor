import Link from "next/link";
import type { ReactNode } from "react";
import { RANGE_PRESETS } from "@/lib/time";

export function PageHead({ title, sub, children, eyebrow }: { title: string; sub?: ReactNode; children?: ReactNode; eyebrow?: string }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}

/** Date-range selector implemented with links, so it works without client JavaScript. */
export function RangeSelector({ current, basePath, params = {} }: { current: string; basePath: string; params?: Record<string, string> }) {
  return (
    <nav className="segmented" aria-label="Date range">
      {RANGE_PRESETS.map((r) => {
        const q = new URLSearchParams({ ...params, range: r.key });
        return (
          <Link key={r.key} href={`${basePath}?${q}`} aria-current={r.key === current ? "true" : undefined} scroll={false}>
            {r.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Delta({ trend, suffix = "vs previous period" }: { trend: { pct: number; direction: string; tone: string } | null; suffix?: string }) {
  if (!trend) return <span className="delta neutral">no comparison data</span>;
  const arrow = trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "◆";
  return (
    <span className={`delta ${trend.tone}`} title={suffix}>
      {arrow} {Math.abs(trend.pct).toFixed(1)}% <span className="faint">{suffix}</span>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  return <div className={`notice ${tone === "info" ? "" : tone}`}>{children}</div>;
}

export function Tabs({ tabs, current }: { tabs: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function FlashMessage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ok = typeof searchParams.ok === "string" ? searchParams.ok : null;
  const err = typeof searchParams.error === "string" ? searchParams.error : null;
  if (!ok && !err) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Notice tone={err ? "error" : "ok"}>
        <p>{err ?? ok}</p>
      </Notice>
    </div>
  );
}
