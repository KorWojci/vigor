"use client";

import { useState, type DragEvent } from "react";
import {
  DEFAULT_LAYOUT,
  hiddenWidgets,
  moveWidget,
  nudgeWidget,
  WIDGETS,
  ZONE_LABELS,
  ZONES,
  type DashboardLayout,
  type Zone,
} from "@/lib/dashboard-layout";
import { saveDashboardLayoutAction } from "@/app/(app)/dashboard-actions";

type Column = Zone | "hidden";
const COLUMNS: Column[] = [...ZONES, "hidden"];
const SHORT: Record<Column, string> = { left: "Left", right: "Right", below: "Below", hidden: "Hidden" };

/**
 * Lets the user choose which dashboard widgets are visible, where, and in which order.
 * Drag and drop on desktop; every action also has buttons (keyboard, touch, screen readers).
 */
export function DashboardEditor({ initial, returnTo = "/" }: { initial: DashboardLayout; returnTo?: string }) {
  const [layout, setLayout] = useState<DashboardLayout>(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const items = (c: Column) => (c === "hidden" ? hiddenWidgets(layout) : layout[c]);
  const label = (k: string) => WIDGETS.find((w) => w.key === k)?.label ?? k;
  const kind = (k: string) => WIDGETS.find((w) => w.key === k)?.kind;

  const drop = (e: DragEvent, column: Column, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData("text/plain") || dragging;
    if (key) setLayout((l) => moveWidget(l, key, column, column === "hidden" ? undefined : index));
    setDragging(null);
    setOver(null);
  };

  return (
    <form action={saveDashboardLayoutAction} className="card">
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="card-head">
        <h2>Customize dashboard</h2>
        <div className="row">
          <button type="button" className="btn small" onClick={() => setLayout(DEFAULT_LAYOUT)}>Reset to default</button>
          <a className="btn small" href={returnTo}>Cancel</a>
          <button className="btn primary">Save layout</button>
        </div>
      </div>
      <p className="small muted">
        Drag widgets between columns to place them around the figure, below it, or hide them. You can also use the arrows to reorder and the
        menu to move a widget. Wide charts work best below the figure.
      </p>
      <div className="layout-editor">
        {COLUMNS.map((c) => (
          <section
            key={c}
            className={`layout-col${over === c ? " over" : ""}${c === "hidden" ? " hidden-col" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(c); }}
            onDragLeave={() => setOver((o) => (o === c ? null : o))}
            onDrop={(e) => drop(e, c)}
            aria-label={ZONE_LABELS[c]}
          >
            <h3 className="eyebrow">{ZONE_LABELS[c]} <span className="faint">({items(c).length})</span></h3>
            <ul>
              {items(c).length === 0 && <li className="layout-empty">Drop widgets here</li>}
              {items(c).map((k, i) => (
                <li
                  key={k}
                  className={`layout-item${dragging === k ? " dragging" : ""}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", k); e.dataTransfer.effectAllowed = "move"; setDragging(k); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  onDragOver={(e) => { e.preventDefault(); setOver(c); }}
                  onDrop={(e) => drop(e, c, i)}
                >
                  <span className="grip" aria-hidden="true">⠿</span>
                  <span className="layout-label">
                    {label(k)}
                    {kind(k) === "panel" && <span className="badge" style={{ marginLeft: 6 }}>chart</span>}
                  </span>
                  <span className="layout-actions">
                    {c !== "hidden" && (
                      <>
                        <button type="button" className="btn small" aria-label={`Move ${label(k)} up`} onClick={() => setLayout((l) => nudgeWidget(l, k, -1))}>↑</button>
                        <button type="button" className="btn small" aria-label={`Move ${label(k)} down`} onClick={() => setLayout((l) => nudgeWidget(l, k, 1))}>↓</button>
                      </>
                    )}
                    <select
                      aria-label={`Place ${label(k)}`}
                      value={c}
                      onChange={(e) => setLayout((l) => moveWidget(l, k, e.target.value as Column))}
                    >
                      {COLUMNS.map((z) => <option key={z} value={z}>{SHORT[z]}</option>)}
                    </select>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </form>
  );
}
