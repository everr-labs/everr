package wrap

import "syscall"

// ownGroupAttr also kills the child if wrap dies, since a signal to wrap's
// process group no longer reaches it.
func ownGroupAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
}
