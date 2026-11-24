package store

import (
	"errors"
	"slices"
)

type dirKind int

const (
	dirEmpty dirKind = iota
	dirMarked
	dirUnmarkedStore
	dirResetStopped
	dirForeign
)

type marker struct {
	Version int               `json:"version"`
	Applied map[string]string `json:"applied"`
}

type observed struct {
	kind      dirKind
	marker    marker
	markerErr error
	// queryDatabase is whether a marked store still has the database that
	// every start ends on. Without it no start can succeed.
	queryDatabase bool
}

type resetReason string

const (
	noReset              resetReason = ""
	unmarkedStore        resetReason = "store has no marker"
	resetStopped         resetReason = "a reset stopped before it finished"
	corruptMarker        resetReason = "marker unreadable"
	versionChanged       resetReason = "store version changed"
	unknownMigration     resetReason = "store has a migration this binary lacks"
	changedMigration     resetReason = "an applied migration changed"
	queryDatabaseMissing resetReason = "store data is gone but its marker is not"
)

type plan struct {
	reset       resetReason
	freshMarker bool
	pending     []migration
}

var errForeignDirectory = errors.New("the chDB path holds files that are not a chDB store, so it is not deleted")

func decide(seen observed, local []migration) (plan, error) {
	switch seen.kind {
	case dirEmpty:
		return plan{freshMarker: true, pending: local}, nil
	case dirForeign:
		return plan{}, errForeignDirectory
	case dirUnmarkedStore:
		return resetPlan(unmarkedStore, local), nil
	case dirResetStopped:
		return resetPlan(resetStopped, local), nil
	}
	if seen.markerErr != nil {
		return resetPlan(corruptMarker, local), nil
	}
	if seen.marker.Version != Version {
		return resetPlan(versionChanged, local), nil
	}
	known := make(map[string]string, len(local))
	for _, m := range local {
		known[m.name] = m.sum
	}
	for _, name := range sortedKeys(seen.marker.Applied) {
		sum, ok := known[name]
		if !ok {
			return resetPlan(unknownMigration, local), nil
		}
		if sum != seen.marker.Applied[name] {
			return resetPlan(changedMigration, local), nil
		}
	}
	if len(seen.marker.Applied) > 0 && !seen.queryDatabase {
		return resetPlan(queryDatabaseMissing, local), nil
	}
	var pending []migration
	for _, m := range local {
		if _, done := seen.marker.Applied[m.name]; !done {
			pending = append(pending, m)
		}
	}
	return plan{pending: pending}, nil
}

func resetPlan(reason resetReason, local []migration) plan {
	return plan{reset: reason, freshMarker: true, pending: local}
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
