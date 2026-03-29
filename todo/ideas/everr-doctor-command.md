# `everr doctor` command

## What
A CLI command that inspects the current repo's Everr integration and suggests improvements — missing configuration, outdated agent instructions, suboptimal workflow setup, etc. Designed to be run by a local AI assistant to self-diagnose and fix integration issues.

## Why
Setting up and maintaining the Everr integration across repos requires knowledge that's easy to miss. A doctor command gives the assistant a single entry point to check what's wrong and what could be better, instead of relying on the user to know what to look for.

## Who
Developers using Everr with an AI coding assistant (Claude, Gemini, etc.)

## Rough appetite
medium

## Notes
Could check things like: AGENTS.md / CLAUDE.md presence and freshness, workflow coverage, notification config, missing install steps.
