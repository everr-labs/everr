package api

import (
	"encoding/json"
	"fmt"
)

// requireFields fails like serde does when a non-optional field is missing
// or null, which encoding/json alone would accept as a zero value.
func requireFields(data []byte, fields ...string) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	for _, field := range fields {
		if raw, ok := object[field]; !ok || string(raw) == "null" {
			return fmt.Errorf("missing field `%s`", field)
		}
	}
	return nil
}

// MeResponse is the signed-in identity. Its JSON encoding is what
// `cloud status --json` prints.
type MeResponse struct {
	Email            string  `json:"email"`
	Name             string  `json:"name"`
	OrganizationName string  `json:"organizationName"`
	OrganizationID   string  `json:"organizationId,omitempty"`
	UserID           string  `json:"userId,omitempty"`
	IngestEndpoint   *string `json:"ingestEndpoint"`
}

func (m *MeResponse) UnmarshalJSON(data []byte) error {
	type plain MeResponse
	if err := requireFields(data, "email", "name", "organizationName"); err != nil {
		return err
	}
	return json.Unmarshal(data, (*plain)(m))
}

type ResourceSummary struct {
	Kind      string `json:"kind"`
	Project   string `json:"project"`
	Slug      string `json:"slug"`
	Repoid    string `json:"repoid"`
	UpdatedAt string `json:"updatedAt"`
}

func (r *ResourceSummary) UnmarshalJSON(data []byte) error {
	type plain ResourceSummary
	if err := requireFields(data, "kind", "project", "slug", "repoid", "updatedAt"); err != nil {
		return err
	}
	return json.Unmarshal(data, (*plain)(r))
}

type AdoptOutcome struct {
	Kind         string `json:"kind"`
	Project      string `json:"project"`
	Slug         string `json:"slug"`
	Repoid       string `json:"repoid"`
	AlreadyOwned bool   `json:"alreadyOwned"`
}

func (a *AdoptOutcome) UnmarshalJSON(data []byte) error {
	type plain AdoptOutcome
	if err := requireFields(data, "kind", "project", "slug", "repoid", "alreadyOwned"); err != nil {
		return err
	}
	return json.Unmarshal(data, (*plain)(a))
}

// ResourceEntry is one resource on the wire.
type ResourceEntry struct {
	Path     string `json:"path"`
	Resource any    `json:"resource"`
}

// ApplyState is the complete desired state for one repo, grouped by kind.
type ApplyState struct {
	Dashboards []ResourceEntry `json:"dashboards"`
	Runbooks   []ResourceEntry `json:"runbooks"`
	Alerts     []ResourceEntry `json:"alerts"`
}

// MarshalJSON sends empty kinds as [] since the server treats the state as
// complete and expects every list.
func (s ApplyState) MarshalJSON() ([]byte, error) {
	type plain ApplyState
	orEmpty := func(entries []ResourceEntry) []ResourceEntry {
		if entries == nil {
			return []ResourceEntry{}
		}
		return entries
	}
	return json.Marshal(plain{
		Dashboards: orEmpty(s.Dashboards),
		Runbooks:   orEmpty(s.Runbooks),
		Alerts:     orEmpty(s.Alerts),
	})
}

// ApplySource is best-effort git metadata about where the state came from.
type ApplySource struct {
	Branch    *string `json:"branch,omitempty"`
	CommitSHA *string `json:"commitSha,omitempty"`
	Remote    *string `json:"remote,omitempty"`
}

type ApplyRequest struct {
	Repoid  string       `json:"repoid"`
	State   ApplyState   `json:"state"`
	Source  *ApplySource `json:"source,omitempty"`
	Preview *string      `json:"preview,omitempty"`
	DryRun  bool         `json:"dryRun"`
	// Adopt takes over live resources owned by another repo instead of
	// failing on the ownership conflict.
	Adopt bool `json:"adopt"`
}

type KindResult struct {
	Kind    string   `json:"kind"`
	Created []string `json:"created"`
	Updated []string `json:"updated"`
	Deleted []string `json:"deleted"`
	// Adopted lists live resources taken over from another repo (--adopt).
	Adopted []string `json:"adopted"`
	// Note is a non-fatal advisory about how this kind was reconciled.
	Note *string `json:"note"`
}

func (k *KindResult) UnmarshalJSON(data []byte) error {
	type plain KindResult
	if err := requireFields(data, "kind", "created", "updated", "deleted"); err != nil {
		return err
	}
	return json.Unmarshal(data, (*plain)(k))
}

type ApplyOrganization struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (a *ApplyOrganization) UnmarshalJSON(data []byte) error {
	type plain ApplyOrganization
	if err := requireFields(data, "id", "name"); err != nil {
		return err
	}
	return json.Unmarshal(data, (*plain)(a))
}

type ApplySummary struct {
	DryRun       bool              `json:"dryRun"`
	Results      []KindResult      `json:"results"`
	Organization ApplyOrganization `json:"organization"`
}

func (a *ApplySummary) UnmarshalJSON(data []byte) error {
	type plain ApplySummary
	if err := requireFields(data, "dryRun", "results", "organization"); err != nil {
		return err
	}
	return json.Unmarshal(data, (*plain)(a))
}
