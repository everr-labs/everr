package cmdutil

import (
	"io"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"strings"

	"github.com/pkg/browser"
)

// OpenBrowser opens url in the user's browser without letting the opener
// write to the terminal. Outside macOS, $BROWSER comes first, as with the
// Rust webbrowser crate: dev containers, Codespaces and WSL point it at a
// helper that forwards the URL to the host.
func OpenBrowser(url string) error {
	if runtime.GOOS != "darwin" {
		for entry := range strings.SplitSeq(os.Getenv("BROWSER"), ":") {
			args := strings.Fields(entry)
			if len(args) == 0 {
				continue
			}
			if !slices.ContainsFunc(args, func(arg string) bool { return strings.Contains(arg, "%s") }) {
				args = append(args, "%s")
			}
			for i, arg := range args {
				args[i] = strings.ReplaceAll(arg, "%s", url)
			}
			cmd := exec.Command(args[0], args[1:]...)
			if cmd.Start() == nil {
				go func() { _ = cmd.Wait() }()
				return nil
			}
		}
	}
	browser.Stdout, browser.Stderr = io.Discard, io.Discard
	return browser.OpenURL(url)
}
