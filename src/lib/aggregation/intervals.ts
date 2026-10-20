export type Interval = [start: number, end: number];

/** Merges overlapping intervals and returns them sorted. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function totalLength(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((acc, [s, e]) => acc + (e - s), 0);
}

/** Length of `a` not covered by `b`. */
export function subtractLength(a: Interval[], b: Interval[]): number {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  let total = 0;
  for (const [s, e] of A) {
    let covered = 0;
    for (const [bs, be] of B) {
      const os = Math.max(s, bs);
      const oe = Math.min(e, be);
      if (oe > os) covered += oe - os;
    }
    total += e - s - covered;
  }
  return total;
}
