import type { Breadcrumb } from "./types.js";

export class BreadcrumbBuffer {
  private entries: Breadcrumb[] = [];
  private start = 0;
  private count = 0;

  constructor(private readonly maxEntries: number) {}

  add(crumb: Breadcrumb): void {
    if (this.maxEntries <= 0) {
      return;
    }

    if (this.count < this.maxEntries) {
      this.entries[(this.start + this.count) % this.maxEntries] = crumb;
      this.count += 1;
      return;
    }

    this.entries[this.start] = crumb;
    this.start = (this.start + 1) % this.maxEntries;
  }

  all(): Breadcrumb[] {
    return Array.from({ length: this.count }, (_, index) => this.at(index));
  }

  filtered(traceId: string | undefined): Breadcrumb[] {
    return this.all().filter(
      (crumb) => !crumb.traceId || crumb.traceId === traceId,
    );
  }

  clear(): void {
    this.entries = [];
    this.start = 0;
    this.count = 0;
  }

  private at(index: number): Breadcrumb {
    return this.entries[(this.start + index) % this.maxEntries];
  }
}
