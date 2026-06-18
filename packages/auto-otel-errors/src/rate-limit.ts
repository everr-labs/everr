const PRUNE_THRESHOLD = 1000;

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly count: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= this.count) {
      this.hits.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    if (this.hits.size > PRUNE_THRESHOLD) {
      this.prune(cutoff);
    }

    return true;
  }

  private prune(cutoff: number): void {
    for (const [key, timestamps] of this.hits) {
      const live = timestamps.filter((t) => t > cutoff);
      if (live.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, live);
      }
    }
  }
}
