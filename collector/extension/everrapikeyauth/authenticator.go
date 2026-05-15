package everrapikeyauth

// authData implements client.AuthData. It exposes tenant/key identifiers so
// processors (e.g. resourceprocessor with `from_context: auth.tenant_id`) can
// stamp them onto telemetry.
type authData struct {
	tenantID string
	keyID    string
}

const (
	attrTenantID = "tenant_id"
	attrKeyID    = "key_id"
)

func (a authData) GetAttribute(name string) any {
	switch name {
	case attrTenantID:
		return a.tenantID
	case attrKeyID:
		return a.keyID
	default:
		return nil
	}
}

func (a authData) GetAttributeNames() []string {
	return []string{attrTenantID, attrKeyID}
}
