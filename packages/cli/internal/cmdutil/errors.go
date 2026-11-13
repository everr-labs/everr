// Package cmdutil holds what command definitions share: positional and flag
// helpers, clap-style help, and the errors that set the exit code.
package cmdutil

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

// ExitError ends the command with Code. Err, when set, is printed as
// "Error: ..."; a nil Err exits silently because the command already
// reported the outcome.
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string {
	if e.Err == nil {
		return fmt.Sprintf("exit status %d", e.Code)
	}
	return e.Err.Error()
}

func (e *ExitError) Unwrap() error { return e.Err }

// Exit ends the command with code without printing anything further.
func Exit(code int) error { return &ExitError{Code: code} }

// UsageError is a command-line parsing error. It exits with status 2 and
// prints the command's usage, like clap. clap left the usage out of
// invalid-value errors, which HideUsage mirrors.
type UsageError struct {
	Cmd       *cobra.Command
	Msg       string
	HideUsage bool
}

func (e *UsageError) Error() string { return e.Msg }

func usageErrorf(cmd *cobra.Command, format string, args ...any) error {
	return &UsageError{Cmd: cmd, Msg: fmt.Sprintf(format, args...)}
}

// UsageErrorf reports invalid arguments for cmd.
func UsageErrorf(cmd *cobra.Command, format string, args ...any) error {
	return usageErrorf(cmd, format, args...)
}

// ExitCode returns the process exit code for err.
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	if exit, ok := errors.AsType[*ExitError](err); ok {
		return exit.Code
	}
	if _, ok := errors.AsType[*UsageError](err); ok {
		return 2
	}
	return 1
}
