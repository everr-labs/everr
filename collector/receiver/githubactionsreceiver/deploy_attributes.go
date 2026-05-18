package githubactionsreceiver

import (
	"strings"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"

	"github.com/everr-labs/everr/collector/semconv"
)

const githubDeploymentsServiceName = "github-deployments"

func setDeploymentResourceAttributes(attrs pcommon.Map, repo *github.Repository, environment string) {
	attrs.PutStr("service.name", githubDeploymentsServiceName)
	if environment != "" {
		attrs.PutStr("deployment.environment.name", environment)
	}
	if repo != nil {
		attrs.PutStr(string(conventions.VCSRepositoryNameKey), repo.GetName())
		attrs.PutStr("vcs.repository.url.full", repo.GetHTMLURL())
		attrs.PutStr(semconv.EverrGitHubRepositoryFullName, repo.GetFullName())
		attrs.PutStr(semconv.EverrGitHubRepositoryOwnerLogin, repo.GetOwner().GetLogin())
	}
}

func deploymentServiceName(task string) string {
	task = strings.TrimSpace(task)
	if task == "" {
		return "deploy"
	}
	if after, ok := strings.CutPrefix(task, "deploy:"); ok && strings.TrimSpace(after) != "" {
		return strings.TrimSpace(after)
	}
	return task
}
