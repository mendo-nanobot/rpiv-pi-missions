---
name: mission-user-testing-validator
description: "Validate a Pi mission feature through user-style QA: run the app when possible, click through flows, check rendering, and capture concrete behavioral evidence."
---

# Mission User Testing Validator

Use this skill for frontend, CLI, API, or product flows where behavior matters more than code shape.

## Purpose

Scrutiny validation asks “does the code look correct?” This validator asks “does the feature work end-to-end?”

## Steps

1. Call `mission_state { "action": "get" }`.
2. Read the feature, validation contract, and handoff.
3. Start the app or relevant process when safe.
4. Exercise real flows:
   - browser/Playwright for web UIs
   - CLI commands for terminal tools
   - HTTP requests for APIs
5. Verify externally visible behavior and failure modes.
6. Prefer concrete evidence: screenshots, command output, HTTP status, rendered text, or test artifacts.
7. Record with `mission_state` action `record_validation`:
   - `validationType`: `user_testing`
   - `validationStatus`: `pass`, `fail`, or `needs_followup`
   - `summary`
   - `assertions`: failed assertion IDs

## Important

Do not accept tests written after implementation as enough evidence. User-style validation should be independent of the worker's code path when possible.
