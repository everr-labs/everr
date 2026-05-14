package health

import (
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHealthServerReportsReadiness(t *testing.T) {
	server := NewServer("127.0.0.1:0")
	require.NoError(t, server.Start())
	t.Cleanup(func() { require.NoError(t, server.Shutdown(t.Context())) })

	resp, err := http.Get(server.URL() + "/")
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
	_ = resp.Body.Close()

	server.SetReady(true)
	resp, err = http.Get(server.URL() + "/")
	require.NoError(t, err)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, string(body), "ok")
}
