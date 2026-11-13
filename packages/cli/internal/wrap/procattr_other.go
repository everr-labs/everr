//go:build !linux

package wrap

import "syscall"

func ownGroupAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
