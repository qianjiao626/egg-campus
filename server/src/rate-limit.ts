type Entry = { timestamps: number[] };

export class InMemoryRateLimiter {
  private readonly entries = new Map<string, Entry>();

  check(key: string, limit: number, windowMs: number, now = Date.now()) {
    const entry = this.entries.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > now - windowMs);
    const allowed = entry.timestamps.length < limit;
    if (allowed) entry.timestamps.push(now);
    this.entries.set(key, entry);
    const oldest = entry.timestamps[0] ?? now;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
}
