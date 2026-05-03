---
name: ralph-finalize
description: Use when finalizing or reviewing a pi-ralph-loop run package, static reports, exported ralph logs, release-readiness evidence, or a handoff bundle. Trigger on phrases like finalize ralph, review package, finalization report, static report, release package, or ralph logs report.
---

# Ralph Finalize Skill

Use this workflow to review and package existing Ralph loop evidence without changing history.

## Safety rules

- Treat finalization as a read-only review-package workflow unless the user explicitly asks for edits.
- Do not rewrite branches, reset history, rebase, cherry-pick, squash, force-push, or otherwise move commits without explicit user approval.
- Do not push unless the user explicitly asks.
- Keep JSONL runner artifacts canonical. Static HTML/Markdown reports are derived convenience views only.
- Prefer copying/exporting artifacts over modifying the original `.ralph-runner/` directory.

## Review package checklist

1. Identify the task directory and exported artifacts.
2. Confirm `status.json`, `iterations.jsonl`, and `events.jsonl` are present when available.
3. Generate or inspect a static report only from copied artifacts.
4. Summarize completion evidence, failures, caveats, and commands/tests run.
5. Leave branch topology unchanged unless the user approves a specific history operation.
