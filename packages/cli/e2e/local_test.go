package e2e

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func identityJSON(service, instance, status string) string {
	body, _ := json.Marshal(map[string]any{
		"service": service, "version": "0.8.2", "instance_id": instance,
		"protocol_version": 1, "status": status,
	})
	return string(body)
}

// healthServer serves an Everr identity on /health.
func healthServer(t *testing.T, service, instance string, starting bool) *httptest.Server {
	t.Helper()
	status, code := "ok", http.StatusOK
	if starting {
		status, code = "starting", http.StatusServiceUnavailable
	}
	return bodyServer(t, code, identityJSON(service, instance, status))
}

func bodyServer(t *testing.T, code int, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(code)
		fmt.Fprint(w, body)
	}))
	t.Cleanup(server.Close)
	return server
}

// stoppedOrigin is a loopback origin nothing listens on.
func stoppedOrigin(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return "http://" + ln.Addr().String()
}

func localEnv(t *testing.T, sql, ui string) *Env {
	return NewEnv(t).Setenv("EVERR_SQL_HTTP_ORIGIN", sql).Setenv("EVERR_LOCAL_UI_ORIGIN", ui).
		Setenv("EVERR_OTLP_HTTP_ORIGIN", stoppedOrigin(t))
}

func TestLocalHelpListsSubcommands(t *testing.T) {
	out := NewEnv(t).Run("local", "--help").Success(t).Stdout
	assertContains(t, out, "start", "query", "status", "Open the running local UI in the default browser")
}

func TestLocalStopIsIdempotentWhenBothListenersAreAbsent(t *testing.T) {
	res := localEnv(t, stoppedOrigin(t), stoppedOrigin(t)).Run("local", "stop").Success(t)
	assertContains(t, res.Stdout, "already stopped")
}

func TestLocalStopRefusesUnrecognizedOrMismatchedInstances(t *testing.T) {
	for _, recognized := range []bool{false, true} {
		collector := healthServer(t, "everr-local-collector", "one", false)
		var stops atomic.Int32
		ui := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/commands/stop_local" {
				stops.Add(1)
				return
			}
			if recognized {
				fmt.Fprint(w, identityJSON("everr-local-ui", "two", "ok"))
			} else {
				fmt.Fprint(w, "other app")
			}
		}))
		t.Cleanup(ui.Close)
		res := localEnv(t, collector.URL, ui.URL).Run("local", "stop").Failure(t, 1)
		assertContains(t, res.Stderr, "cannot stop Everr")
		if stops.Load() != 0 {
			t.Fatalf("stop_local was called %d times", stops.Load())
		}
	}
}

func TestLocalUIReportsTheSameUnavailableStatesAsStatus(t *testing.T) {
	collector := healthServer(t, "everr-local-collector", "one", false)
	mismatchedUI := healthServer(t, "everr-local-ui", "two", false)
	for _, origins := range [][2]string{
		{stoppedOrigin(t), stoppedOrigin(t)},
		{collector.URL, stoppedOrigin(t)},
		{collector.URL, mismatchedUI.URL},
	} {
		env := localEnv(t, origins[0], origins[1])
		status := env.Run("local", "status").Failure(t, 2)
		opened := env.Run("local", "ui").Failure(t, 2)
		if status != opened {
			t.Fatalf("status and ui differ for %v:\nstatus: %+v\nui: %+v", origins, status, opened)
		}
	}
}

func TestLocalStatusReportsRunningWhenCollectorAndUIBelongTogether(t *testing.T) {
	collector := healthServer(t, "everr-local-collector", "one", false)
	ui := healthServer(t, "everr-local-ui", "one", false)
	otlp := stoppedOrigin(t)
	res := localEnv(t, collector.URL, ui.URL).Setenv("EVERR_OTLP_HTTP_ORIGIN", otlp).Run("local", "status").Success(t)
	if want := fmt.Sprintf("otlp: %s\nsql: %s\nui: %s\n", otlp, collector.URL, ui.URL); res.Stdout != want {
		t.Fatalf("stdout = %q, want %q", res.Stdout, want)
	}
	if res.Stderr != "" {
		t.Fatalf("stderr = %q", res.Stderr)
	}
}

func TestLocalStatusReportsStoppedWhenBothListenersAreAbsent(t *testing.T) {
	res := localEnv(t, stoppedOrigin(t), stoppedOrigin(t)).Run("local", "status").Failure(t, 2)
	if res.Stdout != "otlp: stopped\nsql: stopped\nui: stopped\n" {
		t.Fatalf("stdout = %q", res.Stdout)
	}
	assertContains(t, res.Stderr, "everr local start")
}

func TestUnrelatedHTTPSuccessIsNotEverrForEitherListener(t *testing.T) {
	for _, bodies := range [][2]string{
		{"ok", identityJSON("everr-local-ui", "one", "ok")},
		{identityJSON("everr-local-collector", "one", "ok"), "<html>Other app</html>"},
	} {
		sql := bodyServer(t, http.StatusOK, bodies[0])
		ui := bodyServer(t, http.StatusOK, bodies[1])
		env := localEnv(t, sql.URL, ui.URL)
		assertContains(t, env.Run("local", "status").Failure(t, 2).Stdout, "port occupied by an unrecognized service")
		assertContains(t, env.Run("local", "start", "--no-open").Failure(t, 1).Stderr, "port occupied by an unrecognized service")
	}
}

func TestLocalStatusRecognizesStartingCollector(t *testing.T) {
	collector := healthServer(t, "everr-local-collector", "one", true)
	ui := healthServer(t, "everr-local-ui", "one", false)
	res := localEnv(t, collector.URL, ui.URL).Run("local", "status").Failure(t, 2)
	if want := fmt.Sprintf("otlp: starting\nsql: starting\nui: %s\n", ui.URL); res.Stdout != want {
		t.Fatalf("stdout = %q, want %q", res.Stdout, want)
	}
}

func TestLocalStatusShowsSQLUpWhenOnlyThePipelineStopped(t *testing.T) {
	collector := bodyServer(t, http.StatusServiceUnavailable, identityJSON("everr-local-collector", "one", "stopped"))
	ui := healthServer(t, "everr-local-ui", "one", false)
	res := localEnv(t, collector.URL, ui.URL).Run("local", "status").Failure(t, 2)
	if want := fmt.Sprintf("otlp: stopped\nsql: %s\nui: %s\n", collector.URL, ui.URL); res.Stdout != want {
		t.Fatalf("stdout = %q, want %q", res.Stdout, want)
	}
}

func TestLocalStatusReportsAForeignListenerOnTheOTLPPortOnly(t *testing.T) {
	foreign := bodyServer(t, http.StatusOK, "ok")
	env := localEnv(t, stoppedOrigin(t), stoppedOrigin(t)).Setenv("EVERR_OTLP_HTTP_ORIGIN", foreign.URL)
	res := env.Run("local", "status").Failure(t, 2)
	if want := "otlp: port occupied by an unrecognized service\nsql: stopped\nui: stopped\n"; res.Stdout != want {
		t.Fatalf("stdout = %q, want %q", res.Stdout, want)
	}
}

func TestLocalStartReusesReadyInstanceWithoutStartingANewProcess(t *testing.T) {
	collector := healthServer(t, "everr-local-collector", "one", false)
	ui := healthServer(t, "everr-local-ui", "one", false)
	otlp := stoppedOrigin(t)
	env := localEnv(t, collector.URL, ui.URL).Setenv("EVERR_OTLP_HTTP_ORIGIN", otlp)

	res := env.Run("local", "start", "--no-open").Success(t)
	if want := fmt.Sprintf("otlp: %s\nsql: %s\nui: %s\n", otlp, collector.URL, ui.URL); res.Stdout != want || res.Stderr != "" {
		t.Fatalf("stdout = %q, stderr = %q", res.Stdout, res.Stderr)
	}
	res = env.Run("local", "start", "--no-open", "--quiet").Success(t)
	if res.Stdout != "" || res.Stderr != "" {
		t.Fatalf("quiet start printed stdout = %q, stderr = %q", res.Stdout, res.Stderr)
	}
}

func TestPartialInstanceIsReportedAndStartRefusesToReplaceIt(t *testing.T) {
	collector := healthServer(t, "everr-local-collector", "one", false)
	otlp := stoppedOrigin(t)
	env := localEnv(t, collector.URL, stoppedOrigin(t)).Setenv("EVERR_OTLP_HTTP_ORIGIN", otlp)
	res := env.Run("local", "status").Failure(t, 2)
	if want := fmt.Sprintf("otlp: %s\nsql: %s\nui: stopped\n", otlp, collector.URL); res.Stdout != want {
		t.Fatalf("stdout = %q, want %q", res.Stdout, want)
	}
	res = env.Run("local", "start", "--no-open").Failure(t, 1)
	assertContains(t, res.Stderr, "cannot start Everr", ": running")
}

func TestMismatchedInstancesAreNotReportedAsACompleteRunningInstance(t *testing.T) {
	collector := healthServer(t, "everr-local-collector", "one", false)
	ui := healthServer(t, "everr-local-ui", "two", false)
	env := localEnv(t, collector.URL, ui.URL)
	assertContains(t, env.Run("local", "status").Failure(t, 2).Stdout, "do not belong to the same Everr instance")
	assertContains(t, env.Run("local", "start", "--no-open").Failure(t, 1).Stderr, "cannot start Everr")
}

func TestLocalStartLeavesUnrelatedOTLPListenerRunning(t *testing.T) {
	otlp, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer otlp.Close()
	address := otlp.Addr().String()
	res := localEnv(t, stoppedOrigin(t), stoppedOrigin(t)).
		Setenv("EVERR_OTLP_HTTP_ORIGIN", "http://"+address).
		Run("local", "start", "--no-open").Failure(t, 1)
	assertContains(t, res.Stderr, address, "is unavailable")
	if _, err := net.Listen("tcp", address); err == nil {
		t.Fatal("unrelated OTLP listener was closed")
	}
}

func TestLocalQueryConnectionErrorMentionsStartCommand(t *testing.T) {
	res := NewEnv(t).Setenv("EVERR_SQL_HTTP_ORIGIN", "http://127.0.0.1:9").Run("local", "query", "SHOW TABLES").Failure(t, 2)
	assertContains(t, res.Stderr, "everr local start")
	if strings.Contains(res.Stdout, "SHOW") {
		t.Fatalf("stdout = %q", res.Stdout)
	}
}
