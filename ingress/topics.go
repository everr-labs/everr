package main

import "strings"

const (
	topicCollector = "collector"
	topicCDEvents  = "cdevents"
	topicApp       = "app"
)

func topicsForEventType(eventType string) []string {
	switch strings.TrimSpace(eventType) {
	case "workflow_run", "workflow_job":
		return []string{topicCollector, topicCDEvents}
	case "installation", "installation_repositories":
		return []string{topicApp}
	default:
		return nil
	}
}
