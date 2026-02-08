// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package semconv

// Contrib — VCS extensions from opentelemetry-collector-contrib/receiver/githubreceiver
// OTel standard VCS keys should be imported from go.opentelemetry.io/otel/semconv/v1.38.0
const (
	VCSRefHeadRevisionAuthorName  = "vcs.ref.head.revision.author.name"
	VCSRefHeadRevisionAuthorEmail = "vcs.ref.head.revision.author.email"
)

// Citric — Git commit attributes with no OTel/contrib equivalent
const (
	CitricGitHeadCommitCommitterName  = "citric.git.head_commit.committer.name"
	CitricGitHeadCommitCommitterEmail = "citric.git.head_commit.committer.email"
	CitricGitHeadCommitMessage        = "citric.git.head_commit.message"
	CitricGitHeadCommitTimestamp      = "citric.git.head_commit.timestamp"
	CitricGitPullRequestsURL          = "citric.git.pull_requests.url"
)
