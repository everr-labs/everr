package store

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

var localFiles = []migration{
	{name: "0001-setup.sql", sum: "sum1"},
	{name: "0003-tables.sql", sum: "sum3"},
	{name: "0005-views.sql", sum: "sum5"},
}

func marked(version int, applied map[string]string) observed {
	return observed{kind: dirMarked, marker: marker{Version: version, Applied: applied}}
}

func names(migrations []migration) []string {
	var out []string
	for _, m := range migrations {
		out = append(out, m.name)
	}
	return out
}

func TestDecideBuildsAFreshStoreInAnEmptyDirectory(t *testing.T) {
	p, err := decide(observed{kind: dirEmpty}, localFiles)

	require.NoError(t, err)
	require.Equal(t, plan{freshMarker: true, pending: localFiles}, p)
}

func TestDecideRefusesToDeleteADirectoryThatIsNotTheStore(t *testing.T) {
	_, err := decide(observed{kind: dirForeign}, localFiles)

	require.ErrorIs(t, err, errForeignDirectory)
}

func TestDecideKeepsAStoreThatMatches(t *testing.T) {
	seen := marked(Version, map[string]string{"0001-setup.sql": "sum1", "0003-tables.sql": "sum3", "0005-views.sql": "sum5"})

	p, err := decide(seen, localFiles)

	require.NoError(t, err)
	require.Equal(t, plan{}, p)
}

func TestDecideAppliesOnlyTheFilesTheMarkerLacks(t *testing.T) {
	seen := marked(Version, map[string]string{"0001-setup.sql": "sum1", "0005-views.sql": "sum5"})

	p, err := decide(seen, localFiles)

	require.NoError(t, err)
	require.Equal(t, noReset, p.reset)
	require.False(t, p.freshMarker)
	require.Equal(t, []string{"0003-tables.sql"}, names(p.pending))
}

func TestDecideResetsWhenTheStoreCannotBeTrusted(t *testing.T) {
	good := map[string]string{"0001-setup.sql": "sum1"}
	for name, tc := range map[string]struct {
		seen observed
		want resetReason
	}{
		"a higher version":            {marked(Version+1, good), versionChanged},
		"a lower version":             {marked(Version-1, good), versionChanged},
		"a marker without a version":  {marked(0, good), versionChanged},
		"a file this binary lacks":    {marked(Version, map[string]string{"0001-setup.sql": "sum1", "0002-gone.sql": "x"}), unknownMigration},
		"a file whose hash differs":   {marked(Version, map[string]string{"0001-setup.sql": "edited"}), changedMigration},
		"an unreadable marker":        {observed{kind: dirMarked, markerErr: errors.New("marker is not JSON")}, corruptMarker},
		"a chDB layout and no marker": {observed{kind: dirChDB}, unmarkedStore},
	} {
		t.Run(name, func(t *testing.T) {
			p, err := decide(tc.seen, localFiles)

			require.NoError(t, err)
			require.Equal(t, plan{reset: tc.want, freshMarker: true, pending: localFiles}, p)
		})
	}
}
