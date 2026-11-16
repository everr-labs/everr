//go:build unix

package e2e

import (
	"bytes"
	"cmp"
	"io"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

// A terminal that never answers must not stall startup or receive escape
// queries: agent tools and `docker run -t` give everr exactly this.
func TestStartupSendsNoTerminalQueryToSilentPty(t *testing.T) {
	master, slave, err := pty.Open()
	if err != nil {
		t.Skipf("no pty: %v", err)
	}
	defer master.Close()

	cmd := NewEnv(t).Command("--version")
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	started := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	slave.Close()

	var out bytes.Buffer
	copied := make(chan struct{})
	go func() {
		_, _ = io.Copy(&out, master)
		close(copied)
	}()

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		_ = cmd.Process.Kill()
		<-exited
		t.Fatalf("everr --version did not exit within 2s (output %q)", out.String())
	}
	t.Logf("exited after %s", time.Since(started))
	select {
	case <-copied:
	case <-time.After(time.Second):
	}
	if bytes.IndexByte(out.Bytes(), 0x1b) >= 0 {
		t.Fatalf("output contains an escape byte: %q", out.String())
	}
}

const (
	installPrompt = "Install all bundled Everr skills?"
	bgQuery       = "\x1b]11;?"
	da1Query      = "\x1b[c"
)

// A prompt on a terminal that never answers must show up at once, and must not
// query a terminal that cannot show colors anyway.
func TestPromptOnSilentPty(t *testing.T) {
	// The first run of a fresh binary waits on macOS's signature check.
	NewEnv(t).Run("--version")
	for _, tc := range []struct {
		name   string
		env    []string
		forbid []string
	}{
		{"default", nil, nil},
		{"NO_COLOR", []string{"NO_COLOR=1"}, []string{bgQuery}},
		{"TERM=dumb", []string{"TERM=dumb"}, []string{bgQuery, "\x1b["}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out, took := promptOnPty(t, tc.env, "", installPrompt)
			if !strings.Contains(out, installPrompt) {
				t.Fatalf("no prompt after %s (output %q)", took, out)
			}
			t.Logf("prompt after %s", took)
			if took > time.Second {
				t.Errorf("prompt took %s on a silent pty (output %q)", took, out)
			}
			for _, seq := range tc.forbid {
				if strings.Contains(out, seq) {
					t.Errorf("terminal received %q (output %q)", seq, out)
				}
			}
		})
	}
}

func TestPromptPaletteFollowsTerminalBackground(t *testing.T) {
	const darkAccent, lightAccent = "38;2;215;255;0", "38;2;103;125;0"
	for _, tc := range []struct {
		name, reply, want, not string
	}{
		{"dark", "\x1b]11;rgb:0000/0000/0000\x1b\\", darkAccent, lightAccent},
		{"light", "\x1b]11;rgb:ffff/ffff/ffff\x1b\\", lightAccent, darkAccent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out, took := promptOnPty(t, []string{"COLORTERM=truecolor"}, tc.reply, tc.want)
			if !strings.Contains(out, tc.want) {
				t.Fatalf("no %s accent after %s (output %q)", tc.name, took, out)
			}
			if strings.LastIndex(out, tc.not) > strings.Index(out, tc.want) {
				t.Errorf("the %s palette gave way to the other one (output %q)", tc.name, out)
			}
		})
	}
}

// promptOnPty runs `everr skills install` on a 24x80 pty until the terminal
// has received want, or for 5s, and returns everything received up to 300ms
// later, with how long want took. A non-empty reply answers background color
// queries, then device attribute queries, as a real terminal would.
func promptOnPty(t *testing.T, env []string, reply, want string) (string, time.Duration) {
	t.Helper()
	master, slave, err := pty.Open()
	if err != nil {
		t.Skipf("no pty: %v", err)
	}
	defer master.Close()
	if err := pty.Setsize(master, &pty.Winsize{Rows: 24, Cols: 80}); err != nil {
		t.Fatal(err)
	}

	cmd := NewEnv(t).Command("skills", "install")
	cmd.Env = slices.DeleteFunc(cmd.Env, func(kv string) bool {
		return strings.HasPrefix(kv, "NO_COLOR=") || strings.HasPrefix(kv, "COLORTERM=")
	})
	cmd.Env = append(append(cmd.Env, "TERM=xterm-256color"), env...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	started := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	slave.Close()
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	chunks := make(chan []byte)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		defer close(chunks)
		for {
			buf := make([]byte, 4096)
			n, err := master.Read(buf)
			if err != nil {
				return
			}
			select {
			case chunks <- buf[:n]:
			case <-stop:
				return
			}
		}
	}()

	answers := [][2]string{{bgQuery, reply}, {da1Query, "\x1b[?62;22c"}}
	answered := make([]int, len(answers))
	var out []byte
	var took time.Duration
	deadline := time.After(5 * time.Second)
	for {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				return string(out), cmp.Or(took, time.Since(started))
			}
			out = append(out, chunk...)
			for i, qa := range answers {
				for ; reply != "" && answered[i] < bytes.Count(out, []byte(qa[0])); answered[i]++ {
					_, _ = master.Write([]byte(qa[1]))
				}
			}
			if took == 0 && bytes.Contains(out, []byte(want)) {
				took = time.Since(started)
				deadline = time.After(300 * time.Millisecond)
			}
		case <-deadline:
			return string(out), cmp.Or(took, time.Since(started))
		}
	}
}
