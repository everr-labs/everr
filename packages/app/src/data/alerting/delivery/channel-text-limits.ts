// Hard text limits the channel APIs enforce. A message over its channel's
// limit is rejected outright, and it then fails every retry the same way, so
// the composer and every sender bound against this one record.
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
 * this, so a message built once can go to every channel type. It is derived,
 * not named, so a new channel with a smaller limit tightens the budget on its
 * own.
 */
export const CHANNEL_TEXT_MIN = Math.min(
  ...Object.values(CHANNEL_TEXT_MAX),
) as number;
