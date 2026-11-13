package cmdutil

import "github.com/spf13/cobra"

// HumanStdoutFunc reports whether a parsed command writes human-readable
// output (rather than JSON or NDJSON) to stdout. Notices such as the update
// prompt only print when it does, so they never corrupt machine output.
type HumanStdoutFunc func(cmd *cobra.Command, stdoutIsTerminal bool) bool

var humanStdout = map[*cobra.Command]HumanStdoutFunc{}

// SetHumanStdout declares how cmd's stdout reads. Commands that never print
// machine-readable output can pass HumanAlways.
func SetHumanStdout(cmd *cobra.Command, fn HumanStdoutFunc) {
	humanStdout[cmd] = fn
}

func HumanAlways(*cobra.Command, bool) bool { return true }

// PrintsHumanStdout reports whether cmd, once parsed, writes human output.
// Commands that did not declare it are treated as machine output.
func PrintsHumanStdout(cmd *cobra.Command, stdoutIsTerminal bool) bool {
	if fn, ok := humanStdout[cmd]; ok {
		return fn(cmd, stdoutIsTerminal)
	}
	return false
}
