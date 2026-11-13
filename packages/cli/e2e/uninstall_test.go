package e2e

import (
	"os"
	"strings"
	"testing"
)

func TestUninstallWipesTheSessionAndExplainsHowToRemoveTheBinary(t *testing.T) {
	env := NewEnv(t)
	env.WriteSession("https://app.example", "token")
	cmd := env.Command("uninstall")
	cmd.Stdin = strings.NewReader("\n")
	res := RunCmd(t, cmd).Success(t)
	assertContains(t, res.Stdout, "Press Enter to continue", "To remove the CLI binary, run:", "rm \"")
	if _, err := os.Stat(env.SessionPath()); !os.IsNotExist(err) {
		t.Fatalf("session file still exists: %v", err)
	}
}
