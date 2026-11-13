// Package auth signs in to Everr Cloud and resolves the credential API
// clients use.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/pkg/browser"

	"github.com/everr-labs/everr/packages/cli/internal/api"
	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/session"
)

// Not gated to debug builds: the previous CLI read it in release builds too.
const apiBaseURLOverrideEnv = "EVERR_API_BASE_URL_FOR_TESTS"

// NormalizeURL validates an installation URL and strips trailing slashes.
func NormalizeURL(value string) (string, error) {
	raw := strings.TrimSpace(value)
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("Invalid installation URL: %w", err)
	}
	if u.Scheme == "" {
		return "", errors.New("Invalid installation URL: relative URL without a base")
	}
	if (u.Scheme != "http" && u.Scheme != "https") ||
		u.Hostname() == "" ||
		u.User != nil ||
		u.RawQuery != "" || u.ForceQuery ||
		strings.Contains(raw, "#") {
		return "", errors.New("Installation URL must be an HTTP(S) URL without credentials, query, or fragment")
	}
	// Like the URL parser the previous CLI used: lowercase host, no default port.
	hostname, port := strings.ToLower(u.Hostname()), u.Port()
	if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
		port = ""
	}
	switch {
	case port != "":
		u.Host = net.JoinHostPort(hostname, port)
	case strings.Contains(hostname, ":"):
		u.Host = "[" + hostname + "]"
	default:
		u.Host = hostname
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	return strings.TrimRight(u.String(), "/"), nil
}

// RequireSession returns the saved session or tells the user to log in.
func RequireSession() (session.Session, error) {
	store, err := session.User()
	if err != nil {
		return session.Session{}, err
	}
	s, err := store.Load()
	if err != nil {
		return session.Session{}, err
	}
	if s == nil {
		return session.Session{}, errors.New("No active session. Run `everr cloud login`.")
	}
	return *s, nil
}

// NewClient builds the API client for a command. With allowAPIKey (apply),
// EVERR_API_KEY (or the deprecated EVERR_API_TOKEN) wins over the saved
// session, targeting EVERR_API_URL or else the saved session's URL.
func NewClient(allowAPIKey bool) (*api.Client, error) {
	if allowAPIKey {
		token := os.Getenv("EVERR_API_KEY")
		if token == "" {
			token = os.Getenv("EVERR_API_TOKEN")
		}
		if token != "" {
			target := os.Getenv("EVERR_API_URL")
			if target == "" {
				store, err := session.User()
				if err != nil {
					return nil, err
				}
				s, err := store.Load()
				if err != nil {
					return nil, err
				}
				if s == nil {
					return nil, errors.New("EVERR_API_KEY is set but no target URL is configured; set EVERR_API_URL or run `everr cloud login`.")
				}
				target = s.APIBaseURL
			}
			normalized, err := NormalizeURL(target)
			if err != nil {
				return nil, err
			}
			return api.FromToken(normalized, token)
		}
	}
	s, err := RequireSession()
	if err != nil {
		return nil, err
	}
	return api.FromSession(s)
}

// LoginOptions are the `cloud login` flags.
type LoginOptions struct {
	// URL is the installation to sign in to; nil uses the saved session's
	// URL, else the build default.
	URL    *string
	NoOpen bool
}

// Login signs in with the device flow and saves the session.
func Login(ctx context.Context, out io.Writer, opts LoginOptions) error {
	store, err := session.User()
	if err != nil {
		return err
	}
	var target string
	if opts.URL != nil {
		target = *opts.URL
	} else {
		saved, err := store.Load()
		if err != nil {
			return err
		}
		if saved != nil {
			target = saved.APIBaseURL
		} else if target, err = currentAPIBaseURL(); err != nil {
			return err
		}
	}
	apiBaseURL, err := NormalizeURL(target)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "Authenticating with %s\n", apiBaseURL)
	s, err := AuthorizeWithPrompt(ctx, apiBaseURL, func(verificationURL *url.URL, code string) {
		if opts.NoOpen {
			fmt.Fprintf(out, "Open %s and confirm code %s\n", verificationURL, code)
		} else {
			openBrowserWithPrompt(out, verificationURL.String(), code)
		}
	})
	if err != nil {
		return err
	}
	client, err := api.FromSession(s)
	if err != nil {
		return err
	}
	identity, err := client.GetMe(ctx)
	if err != nil {
		return err
	}
	if err := store.Save(s); err != nil {
		return err
	}
	fmt.Fprintf(out, "Logged in as %s\n", identity.Email)
	fmt.Fprintf(out, "Using organization: %s\n", identity.OrganizationName)
	return nil
}

// Logout revokes the saved session and removes it.
func Logout(ctx context.Context, out io.Writer) error {
	store, err := session.User()
	if err != nil {
		return err
	}
	s, err := store.Load()
	if err != nil {
		return err
	}
	if s == nil {
		fmt.Fprintln(out, "No active session.")
		return nil
	}
	client, err := api.FromSession(*s)
	if err != nil {
		return err
	}
	if err := client.Logout(ctx); err != nil {
		return err
	}
	cleared, err := store.Clear(*s)
	if err != nil {
		return err
	}
	if cleared {
		fmt.Fprintln(out, "Logged out.")
	} else {
		fmt.Fprintln(out, "Revoked the previous session. A newer login was preserved.")
	}
	return nil
}

// Status prints the signed-in identity and installation.
func Status(ctx context.Context, out io.Writer, asJSON bool) error {
	client, err := NewClient(false)
	if err != nil {
		return err
	}
	me, err := client.GetMe(ctx)
	if err != nil {
		return err
	}
	if asJSON {
		info := struct {
			URL string `json:"url"`
			*api.MeResponse
		}{client.BaseURL(), me}
		enc := json.NewEncoder(out)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		return enc.Encode(info)
	}
	ingest := "not configured or unavailable on this server"
	if me.IngestEndpoint != nil {
		ingest = *me.IngestEndpoint
	}
	fmt.Fprintf(out, "Name: %s\n", me.Name)
	fmt.Fprintf(out, "Email: %s\n", me.Email)
	fmt.Fprintf(out, "Organization: %s\n", me.OrganizationName)
	fmt.Fprintf(out, "Installation: %s\n", client.BaseURL())
	fmt.Fprintf(out, "Ingestion endpoint: %s\n", ingest)
	return nil
}

func openBrowserWithPrompt(out io.Writer, verificationURL, userCode string) {
	// pkg/browser forwards the opener's output, which must not reach stdout.
	browser.Stdout, browser.Stderr = io.Discard, io.Discard
	if err := browser.OpenURL(verificationURL); err != nil {
		fmt.Fprintf(os.Stderr, "Could not open browser automatically.\nOpen this URL manually: %s (%v)\n", verificationURL, err)
	}

	codeLine := "  Code: " + userCode
	urlLine := "  URL:  " + verificationURL
	width := max(len(codeLine), len(urlLine)) + 2
	bar := strings.Repeat("─", width)
	fmt.Fprintf(out, "┌%s┐\n", bar)
	fmt.Fprintf(out, "│%-*s│\n", width, "  Authenticate")
	fmt.Fprintf(out, "│%-*s│\n", width, "")
	fmt.Fprintf(out, "│%-*s│\n", width, codeLine)
	fmt.Fprintf(out, "│%-*s│\n", width, urlLine)
	fmt.Fprintf(out, "└%s┘\n", bar)
}

func currentAPIBaseURL() (string, error) {
	if value, ok := os.LookupEnv(apiBaseURLOverrideEnv); ok {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return "", errors.New("missing CLI API base URL override")
		}
		return trimmed, nil
	}
	return build.DefaultAPIBaseURL, nil
}
