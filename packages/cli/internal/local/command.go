package local

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/query"
)

const (
	collectorUnavailableMessage = "telemetry collector isn't running — run `everr local start`"
	networkBlockedMessage       = "can't reach the telemetry collector because local network access is blocked for this process — allow access to 127.0.0.1 or run the query outside the sandbox"
)

// NewCommand builds `everr local`.
func NewCommand(lifetime *Lifetime) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "local",
		Short: "Run and query the local telemetry Collector",
	}
	cmd.AddCommand(
		newStartCommand(lifetime),
		&cobra.Command{
			Use:   "stop",
			Short: "Stop the local collector and browser UI",
			RunE: func(c *cobra.Command, _ []string) error {
				return stop(c.Context(), c.OutOrStdout())
			},
		},
		newQueryCommand(),
		&cobra.Command{
			Use:   "status",
			Short: "Show the local Collector status and endpoints",
			RunE: func(c *cobra.Command, _ []string) error {
				status := Inspect(c.Context())
				if _, ok := status.RunningInstance(); !ok {
					return reportUnavailable(c.OutOrStdout(), status)
				}
				status.Print(c.OutOrStdout())
				return nil
			},
		},
		&cobra.Command{
			Use:   "ui",
			Short: "Open the running local UI in the default browser",
			RunE: func(c *cobra.Command, _ []string) error {
				return runUI(c.Context(), c.OutOrStdout())
			},
		},
	)
	for _, sub := range cmd.Commands() {
		if sub.Name() != "query" {
			cmdutil.Positionals(sub)
			cmdutil.SetHumanStdout(sub, cmdutil.HumanAlways)
		}
	}
	return cmd
}

func newStartCommand(lifetime *Lifetime) *cobra.Command {
	var args startArgs
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start the local collector and browser UI",
		RunE: func(c *cobra.Command, _ []string) error {
			return runStart(c.Context(), args, lifetime)
		},
	}
	cmd.Flags().BoolVarP(&args.detach, "detach", "d", false, "Run in the background and return once ready")
	cmd.Flags().BoolVar(&args.quiet, "quiet", false, "Suppress startup output and browser launch")
	cmd.Flags().BoolVar(&args.noOpen, "no-open", false, "Start without opening a browser")
	return cmd
}

func newQueryCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "query",
		Short: "Run read-only SQL against local telemetry",
	}
	args := query.Bind(cmd)
	cmd.RunE = func(c *cobra.Command, _ []string) error {
		rows, err := newSQLClient(build.SQLHTTPOrigin()).Query(c.Context(), args.SQL, nil)
		if err != nil {
			if isConnectError(err) {
				fmt.Fprintln(os.Stderr, connectionFailureMessage(err))
				return cmdutil.Exit(2)
			}
			return fmt.Errorf("query failed: %w", err)
		}
		return query.Render(c.OutOrStdout(), rows, args.Format())
	}
	return cmd
}

func connectionFailureMessage(err error) string {
	if isPermissionDenied(err) {
		return networkBlockedMessage
	}
	return collectorUnavailableMessage
}

func runUI(ctx context.Context, w io.Writer) error {
	status := Inspect(ctx)
	if _, ok := status.RunningInstance(); !ok {
		return reportUnavailable(w, status)
	}
	origin := build.LocalUIOrigin()
	if err := openBrowser(origin); err != nil {
		return fmt.Errorf("Could not open the local UI. Open this URL manually: %s: %w", origin, err)
	}
	fmt.Fprintf(w, "ui: %s\n", origin)
	return nil
}

func reportUnavailable(w io.Writer, status Status) error {
	status.Print(w)
	if status.Stopped() {
		fmt.Fprintln(os.Stderr, "Everr isn't running - run `everr local start`")
	}
	return cmdutil.Exit(2)
}
