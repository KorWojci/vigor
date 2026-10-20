const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" {...base}><circle cx="12" cy="12" r="9" /><rect x="5.5" y="5.5" width="13" height="13" opacity=".6" /><circle cx="12" cy="8" r="1.4" /><path d="M12 10v5m-4-3h8m-4 3-2.5 3.5M12 15l2.5 3.5" /></svg>
  ),
  metrics: (
    <svg viewBox="0 0 24 24" {...base}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>
  ),
  nutrition: (
    <svg viewBox="0 0 24 24" {...base}><path d="M12 7c-3-3-8-1-8 4 0 5 4 9 8 9s8-4 8-9c0-5-5-7-8-4Z" /><path d="M12 7c0-2 1-4 3-4" /></svg>
  ),
  training: (
    <svg viewBox="0 0 24 24" {...base}><path d="M6 8v8M3.5 10v4M18 8v8M20.5 10v4M6 12h12" /></svg>
  ),
  body: (
    <svg viewBox="0 0 24 24" {...base}><path d="M4 7h16M4 7v3M8 7v2M12 7v3M16 7v2M20 7v3" /><path d="M4 17c3-2 13-2 16 0" /></svg>
  ),
  apple: (
    <svg viewBox="0 0 24 24" {...base}><path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" /><path d="M3 12h4l1.5-2 2 4 1.5-2h9" opacity=".7" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...base}><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1" /></svg>
  ),
};
