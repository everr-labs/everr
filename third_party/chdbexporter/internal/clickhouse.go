package internal

import (
	"fmt"
	"time"
)

const DefaultDatabase = "default"

func GenerateTTLExpr(ttl time.Duration, timeField string) string {
	if ttl <= 0 {
		return ""
	}

	switch {
	case ttl%(24*time.Hour) == 0:
		return fmt.Sprintf(`TTL %s + toIntervalDay(%d)`, timeField, ttl/(24*time.Hour))
	case ttl%time.Hour == 0:
		return fmt.Sprintf(`TTL %s + toIntervalHour(%d)`, timeField, ttl/time.Hour)
	case ttl%time.Minute == 0:
		return fmt.Sprintf(`TTL %s + toIntervalMinute(%d)`, timeField, ttl/time.Minute)
	default:
		return fmt.Sprintf(`TTL %s + toIntervalSecond(%d)`, timeField, ttl/time.Second)
	}
}
