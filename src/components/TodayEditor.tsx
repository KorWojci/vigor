"use client";

import { useState, type DragEvent } from "react";
import { getMetric } from "@/lib/metrics/catalog";
import {
  DEFAULT_TODAY_LAYOUT,
  moveTodayMetric,
  nudgeTodayMetric,
  TODAY_COLUMNS,
  TODAY_COLUMN_LABELS,
  TODAY_SECTION_LABELS,
  TODAY_SECTIONS,
  type TodayColumn,
  type TodayLayout,
  type TodaySection,
} from "@/lib/today-layout";
import { saveTodayLayoutAction } from "@/app/(app)/today/actions";

/**
 * Lets the user choose which Today-page metrics are always visible vs. collapsed under "Show
 * more", per section, and in what order. Same drag-and-drop-with-button-fallback interaction as
 * DashboardEditor, just with two columns per section instead of three zones.
 */
export function TodayEditor({ initial }: { initial: TodayLayout }) {
  const [layout, setLayout] = useState<TodayLayout>(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null); // `${section}:${column}`

  const drop = (e: DragEvent, section: TodaySection, column: TodayColumn, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData("text/plain") || dragging;
    if (key) setLayout((l) => moveTodayMetric(l, section, key, column, index));
    setDragging(null);
    setOver(null);
  };

  return (
    <form action={saveTodayLayoutAction} className="card">
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <div className="card-head">
        <h2>Customize Today</h2>
        <div className="row">
          <button type="button" className="btn small" onClick={() => setLayout(DEFAULT_TODAY_LAYOUT)}>Reset to default</button>
          <a className="btn small" href="/today">Cancel</a>
          <button className="btn primary">Save layout</button>
        </div>
      </div>
      <p className="small muted">
        Drag metrics between columns, or use the arrows and the menu. Metrics under “{TODAY_COLUMN_LABELS.more}” still appear on the page, collapsed
        behind a “Show more” toggle.
      </p>
      {TODAY_SECTIONS.map((section) => (
        <div key={section} style={{ marginTop: 18 }}>
          <h3 className="eyebrow">{TODAY_SECTION_LABELS[section]}</h3>
          <div className="grid grid-2">
            {TODAY_COLUMNS.map((column) => {
              const colKey = `${section}:${column}`;
              const items = layout[section][column];
              return (
                <section
                  key={column}
                  className={`layout-col${over === colKey ? " over" : ""}${column === "more" ? " hidden-col" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(colKey); }}
                  onDragLeave={() => setOver((o) => (o === colKey ? null : o))}
                  onDrop={(e) => drop(e, section, column)}
                  aria-label={`${TODAY_SECTION_LABELS[section]} — ${TODAY_COLUMN_LABELS[column]}`}
                >
                  <h3 className="eyebrow">{TODAY_COLUMN_LABELS[column]} <span className="faint">({items.length})</span></h3>
                  <ul>
                    {items.length === 0 && <li className="layout-empty">Drop metrics here</li>}
                    {items.map((key, i) => (
                      <li
                        key={key}
                        className={`layout-item${dragging === key ? " dragging" : ""}`}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", key); e.dataTransfer.effectAllowed = "move"; setDragging(key); }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}
                        onDragOver={(e) => { e.preventDefault(); setOver(colKey); }}
                        onDrop={(e) => drop(e, section, column, i)}
                      >
                        <span className="grip" aria-hidden="true">⠿</span>
                        <span className="layout-label">{getMetric(key)?.label ?? key}</span>
                        <span className="layout-actions">
                          <button type="button" className="btn small" aria-label={`Move ${getMetric(key)?.label} up`} onClick={() => setLayout((l) => nudgeTodayMetric(l, section, key, -1))}>↑</button>
                          <button type="button" className="btn small" aria-label={`Move ${getMetric(key)?.label} down`} onClick={() => setLayout((l) => nudgeTodayMetric(l, section, key, 1))}>↓</button>
                          <select
                            aria-label={`Place ${getMetric(key)?.label}`}
                            value={column}
                            onChange={(e) => setLayout((l) => moveTodayMetric(l, section, key, e.target.value as TodayColumn))}
                          >
                            {TODAY_COLUMNS.map((c) => <option key={c} value={c}>{TODAY_COLUMN_LABELS[c]}</option>)}
                          </select>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ))}
    </form>
  );
}
