---
What: Replace deprecated `fs2` with `fd-lock` for file locking in `everr-core`
Where: `crates/everr-core/src/state.rs`, `crates/everr-core/Cargo.toml`
Steps to reproduce: N/A
Expected: File locking uses maintained crate with idiomatic RAII API
Actual: Uses `fs2` (deprecated); `File::create` requires write access even for shared locks, breaking read-only sandboxes
Priority: low
Notes: |
  Solution: inline fd-lock's RwLock directly inside load_state / update_state /
  clear_session / clear_mismatched_session (guard and RwLock in same scope avoids
  borrow issues). Delete lock_shared / lock_exclusive / acquire_lock helpers.
  Add open_lock_file() helper that falls back to read-only File::open for shared
  locks (flock(LOCK_SH) doesn't require write access on POSIX) — fixes sandbox issue.
---
