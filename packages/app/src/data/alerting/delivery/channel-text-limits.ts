// Hard text limits the channel APIs enforce. A message over its channel's
// limit is rejected outright, and a rejected send fails every retry
// identically, so the composer and every sender belt bound against this one
// record.
export const CHANNEL_TEXT_MAX = {
  // Per section block.
  slack: 3000,
  // Message content.
  discord: 2000,
  // sendMessage text.
  telegram: 4096,
} as const;

/**
 * The tightest limit of any channel. The composed group body budgets against
 * this, so a message built once can be sent to every channel type. Derived
 * rather than named: a new channel with a smaller limit tightens the budget by
 * construction instead of leaving the composer budgeting against a stale one.
 */
export const CHANNEL_TEXT_MIN = Math.min(
  ...Object.values(CHANNEL_TEXT_MAX),
) as number;
