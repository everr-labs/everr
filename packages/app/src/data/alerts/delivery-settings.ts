// The managed CC receivers that back org-level delivery. They are owned by
// the delivery-settings flow (not as-code), so the CC receiver reconciler
// name-guards them against pruning even when hand-stamped.
export const DEFAULT_EMAIL_RECEIVER = "everr-default-email";
export const DEFAULT_TELEGRAM_RECEIVER = "everr-default-telegram";
export const DEFAULT_SLACK_RECEIVER = "everr-default-slack";
