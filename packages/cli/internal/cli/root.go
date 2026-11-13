// Package cli assembles the command tree and runs it.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/apply"
	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/cloud"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/commandtelemetry"
	"github.com/everr-labs/everr/packages/cli/internal/local"
	"github.com/everr-labs/everr/packages/cli/internal/resources"
	"github.com/everr-labs/everr/packages/cli/internal/skills"
	"github.com/everr-labs/everr/packages/cli/internal/uninstall"
	"github.com/everr-labs/everr/packages/cli/internal/updatenotice"
	"github.com/everr-labs/everr/packages/cli/internal/upgrade"
	"github.com/everr-labs/everr/packages/cli/internal/wrap"
	"golang.org/x/term"
)

func init() {
	cobra.EnableCommandSorting = false
}

// NewRoot builds the full command tree.
func NewRoot(lifetime *local.Lifetime) *cobra.Command {
	root := &cobra.Command{
		Use:           cmdutil.RootName,
		Short:         "Query telemetry and manage resources as code in Everr",
		Version:       build.VersionOutput(),
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.Flags().BoolP("version", "V", false, "Print version")
	root.SetVersionTemplate(cmdutil.RootName + " {{.Version}}\n")
	root.CompletionOptions.DisableDefaultCmd = true
	root.AddCommand(
		uninstall.NewCommand(),
		upgrade.NewCommand(),
		cloud.NewCommand(),
		local.NewCommand(lifetime),
		wrap.NewCommand(),
		skills.NewCommand(),
		apply.NewCommand(),
		resources.NewCommand(),
	)
	configureTree(root)
	return root
}

// configureTree applies clap-compatible behavior to every command: clap-style
// help, usage errors with exit status 2, and parent commands that require a
// subcommand.
func configureTree(cmd *cobra.Command) {
	cmd.SetHelpFunc(func(c *cobra.Command, _ []string) {
		cmdutil.RenderHelp(c.OutOrStdout(), c)
	})
	cmd.SetFlagErrorFunc(func(c *cobra.Command, err error) error {
		if invalid, ok := cmdutil.InvalidFlagValue(c, err); ok {
			return invalid
		}
		return cmdutil.UsageErrorf(c, "%s", clapFlagError(err))
	})
	cmd.SilenceErrors, cmd.SilenceUsage = true, true
	// clap listed flags in declaration order.
	cmd.Flags().SortFlags = false
	if cmd.HasSubCommands() {
		if cmd.RunE == nil && cmd.Run == nil {
			cmd.Args = func(c *cobra.Command, args []string) error {
				if len(args) > 0 {
					return cmdutil.UsageErrorf(c, "unrecognized subcommand '%s'", args[0])
				}
				return nil
			}
			cmd.RunE = func(c *cobra.Command, _ []string) error {
				cmdutil.RenderHelp(c.ErrOrStderr(), c)
				return cmdutil.Exit(2)
			}
		}
		// clap gave every command group a `help` subcommand. cobra only adds
		// one to the root, and only once Execute runs, after Main has already
		// resolved the command.
		help := newHelpCommand(cmd)
		if cmd.HasParent() {
			cmd.AddCommand(help)
		} else {
			cmd.SetHelpCommand(help)
			cmd.InitDefaultHelpCmd()
		}
		for _, sub := range cmd.Commands() {
			configureTree(sub)
		}
	}
}

func newHelpCommand(parent *cobra.Command) *cobra.Command {
	return &cobra.Command{
		Use:   "help [COMMAND]...",
		Short: "Print this message or the help of the given subcommand(s)",
		RunE: func(c *cobra.Command, args []string) error {
			target := parent
			for _, name := range args {
				next := findSubcommand(target, name)
				if next == nil {
					return cmdutil.UsageErrorf(target, "unrecognized subcommand '%s'", name)
				}
				target = next
			}
			cmdutil.RenderHelp(c.OutOrStdout(), target)
			return nil
		},
	}
}

func findSubcommand(cmd *cobra.Command, name string) *cobra.Command {
	for _, sub := range cmd.Commands() {
		if sub.Name() != "help" && (sub.Name() == name || sub.HasAlias(name)) {
			return sub
		}
	}
	return nil
}

// Main runs the CLI with argv (without the program name) and returns the
// process exit code.
func Main(argv []string) int {
	stopCapture, captured, err := local.StartLogCapture()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}
	lifetime := &local.Lifetime{}
	root := NewRoot(lifetime)
	shutdownTelemetry := commandtelemetry.Init()

	if target, rest, findErr := root.Find(argv); findErr == nil {
		argv = cmdutil.JoinOptionalValues(target, argv)
		// cobra would print the parent's help for `everr ci nope --help`;
		// clap rejected the unknown subcommand.
		if target.HasSubCommands() {
			for _, arg := range rest {
				if !strings.HasPrefix(arg, "-") {
					err := cmdutil.UsageErrorf(target, "unrecognized subcommand '%s'", arg)
					printError(os.Stderr, err)
					stopCapture()
					return cmdutil.ExitCode(err)
				}
			}
		}
	}
	root.SetArgs(argv)

	finish := func(error) {}
	root.PersistentPreRunE = func(cmd *cobra.Command, _ []string) error {
		ctx, done := commandtelemetry.Start(cmd.Context(), cmd, append([]string{cmdutil.RootName}, argv...))
		finish = done
		cmd.SetContext(ctx)
		if !isUpgrade(cmd) && cmdutil.PrintsHumanStdout(cmd, term.IsTerminal(int(os.Stdout.Fd()))) {
			updatenotice.MaybePrint(ctx, cmd)
		}
		return nil
	}

	_, err = root.ExecuteContextC(context.Background())
	finish(err)
	shutdownTelemetry()

	if captured && err != nil {
		printError(os.Stderr, err)
	}
	stopCapture()
	lifetime.Release()

	printError(os.Stderr, err)
	return cmdutil.ExitCode(err)
}

func isUpgrade(cmd *cobra.Command) bool {
	return cmd.Name() == "upgrade" && cmd.Parent() == cmd.Root()
}

func printError(w io.Writer, err error) {
	if err == nil {
		return
	}
	if usage, ok := errors.AsType[*cmdutil.UsageError](err); ok {
		if usage.HideUsage {
			fmt.Fprintf(w, "error: %s\n\nFor more information, try '--help'.\n", usage.Msg)
			return
		}
		fmt.Fprintf(w, "error: %s\n\nUsage: %s\n\nFor more information, try '--help'.\n", usage.Msg, cmdutil.UsageLine(usage.Cmd))
		return
	}
	if exit, ok := errors.AsType[*cmdutil.ExitError](err); ok && exit.Err == nil {
		return
	}
	if strings.HasPrefix(err.Error(), "unknown command") || strings.HasPrefix(err.Error(), "unknown flag") {
		fmt.Fprintf(w, "error: %s\n", err)
		return
	}
	fmt.Fprintf(w, "Error: %v\n", err)
}

// clapFlagError rewords pflag's unknown-flag errors the way clap reported
// them, which scripts and docs may match on.
func clapFlagError(err error) string {
	msg := err.Error()
	if flag, ok := strings.CutPrefix(msg, "unknown flag: "); ok {
		return fmt.Sprintf("unexpected argument '%s' found", flag)
	}
	if rest, ok := strings.CutPrefix(msg, "unknown shorthand flag: "); ok {
		if _, flag, found := strings.Cut(rest, " in "); found {
			return fmt.Sprintf("unexpected argument '%s' found", flag)
		}
	}
	return msg
}
