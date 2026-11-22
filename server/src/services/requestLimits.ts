export function ipRateLimit(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; expires: number }>();
  let sweepAt = 0;

  function bucket(ip: string) {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [key, entry] of buckets) if (entry.expires <= now) buckets.delete(key);
      sweepAt = now + windowMs;
    }
    const existing = buckets.get(ip);
    return existing && existing.expires > now ? existing : undefined;
  }

  function blocked(ip: string) {
    const existing = bucket(ip);
    return existing ? existing.count >= limit : buckets.size >= 4096;
  }

  function record(ip: string) {
    const existing = bucket(ip);
    if (existing) existing.count++;
    else if (buckets.size < 4096) buckets.set(ip, { count: 1, expires: Date.now() + windowMs });
  }

  return {
    blocked,
    record,
    take(ip: string) {
      if (blocked(ip)) return false;
      record(ip);
      return true;
    },
  };
}

export function sessionLimits() {
  const attempts = ipRateLimit(30, 60_000);
  const slots = new Map<string, Set<symbol>>();
  let active = 0;

  return {
    reserve(ip: string) {
      if (!attempts.take(ip) || active >= 128 || (slots.get(ip)?.size ?? 0) >= 12) return;
      const sessions = slots.get(ip) ?? new Set<symbol>();
      const token = Symbol();
      sessions.add(token);
      slots.set(ip, sessions);
      active++;
      const release = () => {
        if (!sessions.delete(token)) return;
        active--;
        if (!sessions.size) slots.delete(ip);
      };
      return { release, hold: (ms: number) => { setTimeout(release, Math.min(ms, 60 * 60_000)).unref(); } };
    },
  };
}
