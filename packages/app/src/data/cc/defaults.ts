// Mirrors CC's engine grouping defaults (dispatcher/grouping.rs), applied when
// a route leaves a timing field unset.
export const CC_DEFAULT_GROUP_BY = ["rule", "severity"] as const;
export const CC_DEFAULT_GROUP_WAIT_SECS = 10;
export const CC_DEFAULT_GROUP_INTERVAL_SECS = 300;
