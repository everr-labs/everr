package everrapikeyauth

import (
	"slices"
	"strconv"
)

// authData is what the verify endpoint told us, in the shape the resource
// processor reads it: attribute name -> value, so `from_context: auth.<name>`
// can stamp tenant, key and retention onto telemetry (see the processors in
// collector/config.example.yml). It is both the cached verification outcome
// and the client.AuthData handed to the pipeline.
//
// The attributes are built once per verification rather than per lookup: the
// resource processor calls GetAttribute for every resource in every request,
// and the values do not change for the life of a cache entry. Values are
// strings because resource attributes read from context are strings.
type authData struct {
	attrs map[string]string
	names []string
}

func newAuthData(vr verifyResponse) *authData {
	attrs := map[string]string{
		"tenant_id":              vr.TenantID,
		"key_id":                 vr.KeyID,
		"retention_logs_days":    strconv.FormatUint(uint64(vr.LogsDays), 10),
		"retention_traces_days":  strconv.FormatUint(uint64(vr.TracesDays), 10),
		"retention_metrics_days": strconv.FormatUint(uint64(vr.MetricsDays), 10),
	}
	names := make([]string, 0, len(attrs))
	for name := range attrs {
		names = append(names, name)
	}
	slices.Sort(names)
	return &authData{attrs: attrs, names: names}
}

func (a *authData) GetAttribute(name string) any {
	if value, ok := a.attrs[name]; ok {
		return value
	}
	return nil
}

func (a *authData) GetAttributeNames() []string { return a.names }
