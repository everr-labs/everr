// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package semconv

// Contrib — VCS extensions from opentelemetry-collector-contrib/receiver/githubreceiver
// OTel standard VCS keys should be imported from go.opentelemetry.io/otel/semconv/v1.38.0
const (
	VCSRefHeadRevisionAuthorName  = "vcs.ref.head.revision.author.name"
	VCSRefHeadRevisionAuthorEmail = "vcs.ref.head.revision.author.email"
)

// Everr — Git commit attributes with no OTel/contrib equivalent
const (
	EverrGitHeadCommitCommitterName  = "everr.git.head_commit.committer.name"
	EverrGitHeadCommitCommitterEmail = "everr.git.head_commit.committer.email"
	EverrGitHeadCommitMessage        = "everr.git.head_commit.message"
	EverrGitHeadCommitTimestamp      = "everr.git.head_commit.timestamp"
	EverrGitPullRequestsURL          = "everr.git.pull_requests.url"
)
