---
name: mission-orchestrator
description: Plan a Pi mission before code: scope the goal, create milestones/features, and write an implementation-independent validation contract with assertion IDs.
---

# Mission Orchestrator

Use this skill when the user starts or plans a `/mission-*` workflow.

## Discipline

A mission is not a chat session. It is persistent work with:

- objective and scope
- approved plan
- serial features
- milestones
- validation contract before code
- mandatory handoffs
- separate validators
- corrective follow-up features for failed validation

## Steps

1. Read mission state with `mission_state { "action": "get" }`.
2. Read `.pi/missions/<id>/validation-contract.md`.
3. Ask only blocking questions. Otherwise make explicit assumptions.
4. Write/refresh the validation contract before implementation:
   - assertion IDs: `VC-001`, `VC-002`, ...
   - externally observable behaviors
   - negative cases and failure modes
   - integration or end-to-end expectations where relevant
5. Add serial features with `mission_state { "action": "add_feature", "title": "...", "assertions": ["VC-001"] }`.
6. Keep features small enough for one worker pass.
7. Do not start implementation from this skill. After the contract placeholders are replaced and features are added, tell the user to run `/mission-approve`.

## Output

End with:

- mission ID
- feature list in execution order
- validation contract path
- next command: `/mission-next`
