---
name: 004-replay-gdpr
title: What does GDPR require for session replay, cookieless vs consented?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

Under GDPR (and ePrivacy), what does session replay legally require: is consent mandatory, or can replay run on legitimate interest with masking? What masking, PII redaction, retention, and data-subject-rights obligations apply? Specifically: is there any defensible way to run replay on the strictly cookieless, bannerless homepage, and what does the consented product mode need to provide? Survey how PostHog, Sentry, and Highlight position replay consent as reference points.

Findings: research/004-replay-gdpr.md

## Resolution

Verdict: cookieless, bannerless replay is not defensible for EU traffic. Three independent blockers, each from a primary source:

- EDPB Guidelines 2/2023: JavaScript that ships user input, DOM data, or hashed identifiers to a server is "gaining access" under ePrivacy Art 5(3) even with zero cookies; there is no persistence threshold.
- EDPB Opinion 5/2019: where Art 5(3) requires consent, legitimate interest cannot substitute (lex specialis over GDPR Art 6).
- CNIL draft recommendation on session replay (Feb 2026): replay purposes always need prior consent; the audience measurement exemption covers only audience measurement and A/B testing, not replay. It also sets masking by default, mandatory password and payment blocking, sampling or trigger-scoped capture, retention from hours (support) to a few months (UX and errors), per-session deletion, and effective consent withdrawal.

Vendor survey: Sentry masks all text, media, and inputs by default and documents consent-gated init; PostHog masks inputs only, and its own cookieless mode disables replay without consent; Highlight defaults to input plus regex PII masking with no consent guidance.

Decision inputs for the replay ticket, four options: no replay on the homepage (most defensible), CMP-gated replay (abandons bannerless), trigger-scoped consented capture via a support widget (smallest legal surface that still yields data), and unconsented cookieless replay (explicitly a known compliance gap, not a gray zone). Not legal advice; the CNIL text is still a draft.

Full detail: research/004-replay-gdpr.md
