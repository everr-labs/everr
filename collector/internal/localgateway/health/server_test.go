package health

import (
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHealthServerReportsReadiness(t *testing.T) {
	server := NewServer("127.0.0.1:0")
	require.NoError(t, server.Start())
	transport := http.DefaultTransport.(*http.Transport).Clone()
	client := &http.Client{Transport: transport}
	t.Cleanup(func() {
		transport.CloseIdleConnections()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		require.NoError(t, server.Shutdown(ctx))
	})

	resp, err := client.Get(server.URL() + "/")
	require.NoError(t, err)
	require.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
	_ = resp.Body.Close()

	server.SetReady(true)
	resp, err = client.Get(server.URL() + "/")
	require.NoError(t, err)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, string(body), "ok")
}
