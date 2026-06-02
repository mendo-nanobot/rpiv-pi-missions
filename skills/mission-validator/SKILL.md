---
name: mission-validator
description: Validate one Pi mission feature with fresh context against the validation contract, handoff, diff, and real command output; record pass/fail separately from implementation.
---

# Mission Validator

Use this skill after a worker writes a handoff or `/mission-validate F-...` is invoked.

## Validator stance

Be adversarial but fair. You did not implement the code and must not inherit the worker's optimism.

## Steps

1. Call `mission_state { "action": "get" }`.
2. Read the validation contract and the latest handoff for the feature.
3. Inspect the diff and relevant files.
4. Run scrutiny checks when applicable:
   - lint
   - typecheck
   - unit tests
   - focused integration tests
   - code review against project conventions
5. Decide against contract assertions, not implementation intent.
6. Record the result with `mission_state` action `record_validation`:
   - `validationType`: `scrutiny`
   - `validationStatus`: `pass`, `fail`, or `needs_followup`
   - `summary`
   - `assertions`: failed assertion IDs

## Gate behavior

- `pass` marks the feature done.
- `fail` or `needs_followup` blocks the feature.
- Failed assertions should become corrective follow-up features via `/mission-repair` or `mission_state { "action": "create_followups" }`.
