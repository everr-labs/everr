package sqlhttp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"go.uber.org/zap"
)

// extractParams returns a name→raw-JSON map for `param_<name>` URL query args.
func extractParams(values url.Values) map[string]string {
	out := map[string]string{}
	for key, vs := range values {
		if !strings.HasPrefix(key, paramPrefix) || len(vs) == 0 {
			continue
		}
		out[strings.TrimPrefix(key, paramPrefix)] = vs[0]
	}
	return out
}

const maxRequestBody = 64 << 10

var errResultTooBig = errors.New("sqlhttp: result exceeded cap")

type handler struct {
	handle         *chdb.Handle
	queryTimeout   time.Duration
	enqueueTimeout time.Duration
	maxBytes       int64
	logger         *zap.Logger

	ready atomic.Bool
	exec  func(ctx context.Context, sql string) ([]byte, error)
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.ready.Load() {
		w.Header().Set("Retry-After", "1")
		httpError(w, http.StatusServiceUnavailable, "collector starting")
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		httpError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBody+1))
	_ = r.Body.Close()
	if err != nil {
		httpError(w, http.StatusBadRequest, fmt.Sprintf("read body: %v", err))
		return
	}
	if int64(len(body)) > maxRequestBody {
		httpError(w, http.StatusBadRequest, "SQL too large")
		return
	}

	sql := string(body)
	if err := ValidateReadOnly(sql); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}

	params := extractParams(r.URL.Query())
	if len(params) > 0 {
		substituted, err := substituteParams(sql, params)
		if err != nil {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		sql = substituted
	}

	exec := h.exec
	if exec == nil {
		exec = h.execReal
	}

	out, err := exec(r.Context(), sql)
	switch {
	case errors.Is(err, errResultTooBig):
		httpError(w, http.StatusRequestEntityTooLarge, resultTooBigMessage(h.maxBytes))
		return
	case errors.Is(err, chdb.ErrQueueFull), errors.Is(err, context.DeadlineExceeded), errors.Is(err, chdb.ErrClosed):
		w.Header().Set("Retry-After", "1")
		httpError(w, http.StatusServiceUnavailable, "busy")
		return
	case err != nil:
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if int64(len(out)) > h.maxBytes {
		httpError(w, http.StatusRequestEntityTooLarge, resultTooBigMessage(h.maxBytes))
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

func (h *handler) execReal(ctx context.Context, sql string) ([]byte, error) {
	var out []byte
	enqueueCtx, cancel := context.WithTimeout(ctx, h.enqueueTimeout)
	defer cancel()

	done, err := h.handle.Enqueue(enqueueCtx, func(_ context.Context, s chdb.Session) error {
		result, err := s.Query(sql, "JSONEachRow")
		if err != nil {
			return err
		}
		defer result.Free()

		buf := result.Buf()
		if int64(len(buf)) > h.maxBytes {
			return errResultTooBig
		}

		out = append(out[:0], buf...)
		return nil
	})
	if err != nil {
		return nil, err
	}

	queryCtx, cancel := context.WithTimeout(ctx, h.queryTimeout)
	defer cancel()

	select {
	case err := <-done:
		return out, err
	case <-queryCtx.Done():
		return nil, queryCtx.Err()
	}
}

func resultTooBigMessage(maxBytes int64) string {
	if maxBytes == defaultMaxResultBytes {
		return "result exceeded 16 MiB; add LIMIT or narrow the WHERE"
	}
	return fmt.Sprintf("result exceeded %d bytes; add LIMIT or narrow the WHERE", maxBytes)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
