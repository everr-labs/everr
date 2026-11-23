package store

// Version is the store's format. Bumping it makes the next start delete the
// local database and build a new one. Bump it when a store built by an older
// binary must not be reused and no new migration file shows why. A new
// migration file alone needs no bump: it applies on the next start.
const Version = 1
