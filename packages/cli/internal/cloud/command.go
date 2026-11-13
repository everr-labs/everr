// Package cloud implements `everr cloud`.
package cloud

import (
	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/auth"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/query"
)

// NewCommand builds `everr cloud`.
func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "cloud",
		Short: "Authenticate with and query a remote Everr installation",
	}
	cmd.AddCommand(loginCommand(), logoutCommand(), statusCommand(), queryCommand())
	return cmd
}

func loginCommand() *cobra.Command {
	var opts auth.LoginOptions
	var url string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with a remote installation and save the session",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if cmd.Flags().Changed("url") {
				opts.URL = &url
			}
			return auth.Login(cmd.Context(), cmd.OutOrStdout(), opts)
		},
	}
	cmdutil.Positionals(cmd)
	cmd.Flags().SortFlags = false
	cmd.Flags().StringVar(&url, "url", "", "Installation URL (defaults to the saved session or build default)")
	cmd.Flags().BoolVar(&opts.NoOpen, "no-open", false, "Print the authorization URL without opening a browser")
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func logoutCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "logout",
		Short: "Revoke the saved session and sign out",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return auth.Logout(cmd.Context(), cmd.OutOrStdout())
		},
	}
	cmdutil.Positionals(cmd)
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func statusCommand() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show the current identity, installation URL, and ingestion endpoint",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return auth.Status(cmd.Context(), cmd.OutOrStdout(), asJSON)
		},
	}
	cmdutil.Positionals(cmd)
	cmd.Flags().BoolVar(&asJSON, "json", false, "Print connection details, including the ingestion endpoint, as JSON")
	cmdutil.SetHumanStdout(cmd, func(*cobra.Command, bool) bool { return !asJSON })
	return cmd
}

func queryCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "query",
		Short: "Run read-only SQL against telemetry in the remote installation",
	}
	args := query.Bind(cmd)
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		client, err := auth.NewClient(false)
		if err != nil {
			return err
		}
		body, err := client.PostSQL(cmd.Context(), args.SQL)
		if err != nil {
			return err
		}
		rows, err := query.ParseNDJSON(body)
		if err != nil {
			return err
		}
		return query.Render(cmd.OutOrStdout(), rows, args.Format())
	}
	return cmd
}
