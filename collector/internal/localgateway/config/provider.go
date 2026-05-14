package config

import (
	"context"
	"fmt"

	"go.opentelemetry.io/collector/confmap"
)

const StaticScheme = "everr"
const StaticURI = "everr:local"

type staticProvider struct {
	raw map[string]any
}

func NewStaticProviderFactory(raw map[string]any) confmap.ProviderFactory {
	return confmap.NewProviderFactory(func(confmap.ProviderSettings) confmap.Provider {
		return &staticProvider{raw: raw}
	})
}

func (p *staticProvider) Retrieve(ctx context.Context, uri string, _ confmap.WatcherFunc) (*confmap.Retrieved, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	if uri != StaticURI {
		return nil, fmt.Errorf("unsupported config uri %q", uri)
	}
	return confmap.NewRetrieved(p.raw)
}

func (p *staticProvider) Scheme() string {
	return StaticScheme
}

func (p *staticProvider) Shutdown(context.Context) error {
	return nil
}
