// Hard text limits the channel APIs enforce. A message over its channel's
// limit is rejected outright, and a rejected send fails every retry
// identically, so the composer and every sender belt bound against this one
// record.
export const CHANNEL_TEXT_MAX = {
  // Per section block.
  slack: 3000,
  // Message content; the tightest channel, so it drives the composed budget.
  discord: 2000,
  // sendMessage text.
  telegram: 4096,
} as const;
