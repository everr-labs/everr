package everrapikeyauth

import "strconv"

// authData implements client.AuthData. It exposes tenant, key and retention
// so processors (resourceprocessor with `from_context: auth.<name>`) can stamp
// them onto telemetry. Values are strings because resource attributes read
// from context are strings.
type authData struct {
	tenantID    string
	keyID       string
	logsDays    uint16
	tracesDays  uint16
	metricsDays uint16
}

const (
	attrTenantID    = "tenant_id"
	attrKeyID       = "key_id"
	attrLogsDays    = "retention_logs_days"
	attrTracesDays  = "retention_traces_days"
	attrMetricsDays = "retention_metrics_days"
)

func (a authData) GetAttribute(name string) any {
	switch name {
	case attrTenantID:
		return a.tenantID
	case attrKeyID:
		return a.keyID
	case attrLogsDays:
		return strconv.FormatUint(uint64(a.logsDays), 10)
	case attrTracesDays:
		return strconv.FormatUint(uint64(a.tracesDays), 10)
	case attrMetricsDays:
		return strconv.FormatUint(uint64(a.metricsDays), 10)
	default:
		return nil
	}
}

func (a authData) GetAttributeNames() []string {
	return []string{attrTenantID, attrKeyID, attrLogsDays, attrTracesDays, attrMetricsDays}
}
