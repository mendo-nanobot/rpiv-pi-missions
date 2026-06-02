---
name: mission-worker
description: Implement exactly one active Pi mission feature, then write a structured handoff with commands, exit codes, changed behavior, and covered assertions.
---

# Mission Worker

Use this skill after `/mission-next` marks one feature `in_progress`.

## Rules

- Implement exactly one feature.
- Do not work on blocked or future features.
- Read the validation contract before touching code.
- Prefer serial writes; parallelize only read-only exploration via subagents if available.
- Run the smallest meaningful verification commands.
- Never self-certify completion without a handoff.

## Steps

1. Call `mission_state { "action": "get" }`.
2. Identify the feature marked `in_progress` or the feature ID passed by the user.
3. Read its contract assertions.
4. Implement the feature.
5. Run relevant commands and capture exact exit codes.
6. Write a handoff using `mission_state` action `write_handoff`:
   - `featureId`
   - `completed`
   - `leftUndone`
   - `commands`: `{ command, exitCode }`
   - `issues`
   - `assertions`: covered assertion IDs
7. Move the feature to validation with `mission_state { "action": "update_feature", "featureId": "F-...", "status": "in_validation" }`.

## Handoff quality bar

A handoff must let a fresh validator understand what changed without trusting the worker's narrative.
