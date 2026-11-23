package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseOptionsReadsRetentionDays(t *testing.T) {
	opts, err := parseOptions(nil)
	require.NoError(t, err)
	require.EqualValues(t, 7, opts.RetentionDays)

	opts, err = parseOptions([]string{"--retention-days", "30"})
	require.NoError(t, err)
	require.EqualValues(t, 30, opts.RetentionDays)

	for _, invalid := range []string{"0", "65536"} {
		_, err = parseOptions([]string{"--retention-days", invalid})
		require.ErrorContains(t, err, "--retention-days")
	}
}
