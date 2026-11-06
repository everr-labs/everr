// A pausable clock for a stage's script. While paused its time stands still,
// so the act's waits and tweens (and anything else that reads it) hold.

export class Playhead {
  #paused = false;
  #at = 0;
  #last = performance.now();

  /** Milliseconds played, not counting time spent paused. */
  now() {
    const t = performance.now();
    if (!this.#paused) this.#at += t - this.#last;
    this.#last = t;
    return this.#at;
  }

  setPaused(paused: boolean) {
    this.now();
    this.#paused = paused;
  }
}
