// The dispatcher's grouping defaults, mirroring CC's engine constants
// (crates/clickety-clack/src/dispatcher/grouping.rs). Applied when a route
// leaves a timing field unset; surfaced in the route builder so the effective
// behavior is visible without opening the Timing disclosure.
export const CC_DEFAULT_GROUP_BY = ["rule", "severity"] as const;
export const CC_DEFAULT_GROUP_WAIT_SECS = 10;
export const CC_DEFAULT_GROUP_INTERVAL_SECS = 300;
