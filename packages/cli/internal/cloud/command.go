// Package cloud implements `everr cloud`.
package cloud

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/auth"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/datemath"
	"github.com/everr-labs/everr/packages/cli/internal/query"
	"github.com/everr-labs/everr/packages/cli/internal/recording"
)

func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "cloud",
		Short: "Authenticate with and query a remote Everr installation",
	}
	cmd.AddCommand(loginCommand(), logoutCommand(), statusCommand(), queryCommand(), recordingCommand())
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
	cmd.Flags().BoolVar(&asJSON, "json", false, "Print connection details, including the ingestion endpoint, as JSON")
	cmdutil.SetHumanStdout(cmd, func(bool) bool { return !asJSON })
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

const recordingAbout = "Read recordings of browser pages in the remote installation: the page a user saw. Cloud only"

// recordingCommand is `everr cloud recording`. Its output is for agents: it
// declares no human stdout, so no update notice is ever appended to it.
func recordingCommand() *cobra.Command {
	cmd := &cobra.Command{Use: "recording", Short: recordingAbout}
	cmd.AddCommand(recordingShowCommand())
	return cmd
}

func recordingShowCommand() *cobra.Command {
	var stream, at string
	var html bool
	cmd := &cobra.Command{
		Use: "show",
		Short: "Print the page of a recorded visit just after a moment: its elements, their state, " +
			"and the text the app did not mask. Find the stream id and the moment in traces and logs (`everr cloud query`)",
	}
	cmd.Flags().StringVar(&stream, "stream", "", "Stream id (`everr.recording.stream.id` on the browser record of the moment)")
	cmd.Flags().StringVar(&at, "at", "", "The moment: RFC 3339 with a zone, epoch milliseconds or seconds, or date math. "+
		"The page is read 0.75 seconds later")
	cmd.Flags().BoolVar(&html, "html", false, "Print the page as HTML (body only, bounded) instead of an outline")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		var missing []string
		for _, flag := range []string{"stream", "at"} {
			if !cmd.Flags().Changed(flag) {
				missing = append(missing, "--"+flag+" <"+strings.ToUpper(flag)+">")
			}
		}
		if len(missing) > 0 {
			return cmdutil.UsageErrorf(cmd, "the following required arguments were not provided:\n  %s", strings.Join(missing, "\n  "))
		}
		instant, err := datemath.ResolveInstant(at, time.Now())
		if err != nil {
			return fmt.Errorf("--at %q: %w", at, err)
		}
		form := recording.Outline
		if html {
			form = recording.HTML
		}
		client, err := auth.NewClient(false)
		if err != nil {
			return err
		}
		body, err := client.RecordingSegments(cmd.Context(), stream, instant.Format("2006-01-02T15:04:05.000Z07:00"))
		if err != nil {
			return err
		}
		text, err := recording.PageText(body, instant.UnixMilli(), form)
		if err != nil {
			return err
		}
		return writeText(cmd.OutOrStdout(), text)
	}
	return cmd
}

// writeText writes the page text with control characters other than newline
// dropped (the page text has none; this is the last hop to a terminal) and a
// trailing newline.
func writeText(w io.Writer, text string) error {
	text = strings.Map(func(c rune) rune {
		if c != '\n' && (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
			return -1
		}
		return c
	}, text)
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	_, err := io.WriteString(w, text)
	return err
}
