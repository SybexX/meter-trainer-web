// Speed over the last few seconds only. A tab in the background is throttled; a speed
// averaged since the start would keep the slow stretch and every estimate stay wrong after.

/** mark(done) after each unit of work; rate() = units per second over the window. */
export function rollingRate(windowMs = 20000) {
  const pts = []; // [ms, done], the first one at or before the window start
  return {
    mark(done, now = performance.now()) {
      pts.push([now, done]);
      while (pts.length > 2 && now - pts[1][0] >= windowMs) pts.shift();
    },
    rate() {
      if (pts.length < 2) return 0;
      const [t0, d0] = pts[0], [t1, d1] = pts.at(-1);
      return t1 > t0 ? ((d1 - d0) * 1000) / (t1 - t0) : 0;
    },
    /** seconds for `remaining` more units, null while the speed is unknown */
    left(remaining) {
      const r = this.rate();
      return r > 0 ? remaining / r : null;
    },
  };
}
