package main

import (
	"reflect"
	"testing"
)

func TestTopicsForEventType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		eventType string
		want      []string
	}{
		{name: "workflow run", eventType: "workflow_run", want: []string{topicCollector, topicCDEvents}},
		{name: "workflow job", eventType: "workflow_job", want: []string{topicCollector, topicCDEvents}},
		{name: "installation", eventType: "installation", want: []string{topicApp}},
		{name: "installation repositories", eventType: "installation_repositories", want: []string{topicApp}},
		{name: "unsupported", eventType: "ping", want: nil},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := topicsForEventType(tc.eventType)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("unexpected topics for %q: got=%v want=%v", tc.eventType, got, tc.want)
			}
		})
	}
}
