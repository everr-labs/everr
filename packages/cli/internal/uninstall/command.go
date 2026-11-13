package uninstall

import (
	"bufio"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/local"
	"github.com/everr-labs/everr/packages/cli/internal/session"
	"github.com/everr-labs/everr/packages/cli/internal/skills"
)

func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "uninstall",
		Short: "Remove local Everr state and globally installed skills",
		RunE: func(c *cobra.Command, _ []string) error {
			return run(c.OutOrStdout(), c.InOrStdin())
		},
	}
	cmdutil.Positionals(cmd)
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func run(out io.Writer, in io.Reader) error {
	cliPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve current executable path: %w", err)
	}
	fmt.Fprintln(out, "The uninstall command will:")
	fmt.Fprintln(out, "- Removes all local Everr state.")
	fmt.Fprintln(out, "- Removes globally installed Everr skills.")
	fmt.Fprintf(out, "- Does not remove the CLI binary automatically: %s\n", cliPath)
	fmt.Fprintln(out)
	fmt.Fprintln(out, "Press Enter to continue, or Ctrl+C to abort.")
	if _, err := bufio.NewReader(in).ReadString('\n'); err != nil && err != io.EOF {
		return fmt.Errorf("failed to read uninstall confirmation: %w", err)
	}

	store, err := session.User()
	if err != nil {
		return err
	}
	if err := store.Wipe(); err != nil {
		return err
	}
	// Removing skills or the chDB cache must not block wiping the rest.
	if err := skills.UninstallAllGlobal(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not remove Everr skills: %v\n", err)
	}
	if err := local.RemoveLibraryCache(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not remove the extracted chDB library: %v\n", err)
	}
	fmt.Fprintln(out)
	fmt.Fprintln(out, "To remove the CLI binary, run:")
	fmt.Fprintf(out, "  rm \"%s\"\n", cliPath)
	return nil
}
