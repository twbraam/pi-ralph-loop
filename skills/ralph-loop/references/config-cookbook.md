# Ralph loop config cookbook

Copy these patterns into `RALPH.md` and adjust the commands and outputs for the task at hand.

Ralph injects an automatic goal-continuation audit into each iteration. Prefer configs that give the audit concrete evidence: verification commands, required output files, and explicit completion criteria.

## 1. Fix or test a bug

```yaml
---
commands:
  - name: tests
    run: npm test
    timeout: 60
    acceptance: true
max_iterations: 20
completion_promise: DONE
completion_gate: required
required_outputs:
  - TEST_REPORT.md
  - OPEN_QUESTIONS.md
stop_on_error: true
guardrails:
  block_commands:
    - 'git\s+push'
---
```

Use when you want a hard stop only after tests pass on a fresh acceptance rerun, TEST_REPORT.md exists, and OPEN_QUESTIONS.md is clear.

## 2. Make a migration

```yaml
---
commands:
  - name: build
    run: npm run build
    timeout: 60
    acceptance: true
  - name: tests
    run: npm test
    timeout: 120
    acceptance: true
max_iterations: 30
completion_promise: DONE
completion_gate: required
required_outputs:
  - MIGRATION_NOTES.md
  - OPEN_QUESTIONS.md
stop_on_error: false
guardrails:
  block_commands:
    - 'git\s+push'
---
```

Use when the loop should keep going through multiple passes and the deliverable, OPEN_QUESTIONS.md, and fresh build/tests are mandatory.

## 3. Draft documentation

```yaml
---
commands:
  - name: build
    run: npm run build
    timeout: 60
max_iterations: 15
completion_promise: DONE
completion_gate: optional
required_outputs:
  - DOCS_INDEX.md
stop_on_error: false
---
```

Use when the output matters, but you want the loop to be able to stop once the work is complete even if the gate is only advisory.

## 4. Research and summarize findings

```yaml
---
commands:
  - name: inspect
    run: git log --oneline -10
    timeout: 20
max_iterations: 20
completion_promise: DONE
completion_gate: optional
required_outputs:
  - REPORT.md
stop_on_error: false
---
```

Use when the loop should gather evidence and write a report, but the stopping condition is mostly about the report being complete.

## 5. Security or audit work

```yaml
---
commands:
  - name: scan
    run: npm audit --omit=dev
    timeout: 120
    acceptance: true
max_iterations: 20
completion_promise: DONE
completion_gate: required
required_outputs:
  - SECURITY_FINDINGS.md
  - OPEN_QUESTIONS.md
stop_on_error: true
guardrails:
  block_commands:
    - 'git\s+push'
    - 'npm\s+publish'
  protected_files:
    - '.env*'
    - '*.pem'
    - '*.key'
    - 'policy:secret-bearing-paths'
---
```

Use when missing evidence should keep the loop running until the report, OPEN_QUESTIONS.md, and fresh scan are ready.

## 6. Loop without a completion gate

```yaml
---
commands:
  - name: tests
    run: npm test
    timeout: 60
max_iterations: 10
completion_gate: disabled
stop_on_error: true
guardrails:
  block_commands:
    - 'git\s+push'
---
```

Use when you want the loop to run until the iteration budget or a stop request ends it.

## Choosing a gate mode

| Mode | Use it when |
|---|---|
| `required` | The loop must not stop until the promise, outputs, and OPEN_QUESTIONS.md are ready. |
| `optional` | The prompt should remind the agent about the gate, but the loop may stop once the promise is emitted. |
| `disabled` | You do not want completion-gate checks or reminders at all. |

Keep the prompt body aligned with the frontmatter so the agent knows which stop condition is real. The automatic goal audit will use these commands, outputs, and completion criteria to decide whether the goal is actually done.
