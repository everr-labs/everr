package main

import (
	"context"
	"errors"
	"everr.dev/dev/internal/recipe"
	"fmt"
	"os"
	"os/exec"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		var child *exec.ExitError
		if errors.As(err, &child) && child.ExitCode() > 0 {
			os.Exit(child.ExitCode())
		}
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) < 2 {
		return errors.New("expected files, databases, or exec")
	}
	root, state, runtime := os.Getenv("DEV_ROOT"), os.Getenv("DEV_STATE_DIR"), os.Getenv("DEV_RUN_DIR")
	if root == "" || state == "" || runtime == "" {
		return errors.New("run through pnpm dev")
	}
	switch os.Args[1] {
	case "files":
		if err := os.RemoveAll(runtime); err != nil {
			return err
		}
		if err := os.MkdirAll(runtime, 0700); err != nil {
			return err
		}
		return recipe.Prepare(state, runtime)
	case "databases":
		return recipe.Databases(context.Background())
	case "exec":
		return recipe.Exec(os.Args[2:])
	default:
		return fmt.Errorf("unknown provisioning command %q", os.Args[1])
	}
}
