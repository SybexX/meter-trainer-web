// Taking images spread over time: over every hour that has any, so old and new days and day
// and night are all in the set. Used to choose what to download and what to train on.

/** 0..n-1, newest (n-1) first, in an order whose every start is spread over the whole range (bit-reversed). */
function spreadIdx(n) {
  if (!n) return [];
  const bits = Math.max(1, Math.ceil(Math.log2(n))), used = new Uint8Array(n), out = [];
  for (let k = 0; k < 1 << bits; k++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((k >> b) & 1) << (bits - 1 - b);
    const i = n - 1 - Math.floor((r * n) / (1 << bits));
    if (!used[i]) { used[i] = 1; out.push(i); }
  }
  return out;
}

/**
 * items ({ts}) in the order to take them: one per hour ("YYYYMMDD-HH") in turn, each turn's
 * hours spread over the whole time range; within an hour first(item) ones first, then the newest.
 */
export function spreadOrder(items, first = () => false) {
  const cells = new Map();
  for (const it of items) {
    const k = it.ts.slice(0, 11);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(it);
  }
  const queues = [...cells].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, l]) => l.sort((a, b) => (first(b) - first(a)) || (a.ts < b.ts ? 1 : -1)));
  const out = [];
  for (let round = 0; ; round++) {
    const avail = queues.filter((q) => q.length > round);
    if (!avail.length) return out;
    for (const i of spreadIdx(avail.length)) out.push(avail[i][round]);
  }
}
