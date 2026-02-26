---
name: fordan-solar-api
description: Use this skill when implementing or updating backend features for the solar CRM API, especially for customer, team, and connection record workflows with minimal high-value unit tests.
---

# Solar CRM Backend Skill

## When to use
- Any API/domain work related to:
  - Customer records and lifecycle.
  - Team records and ownership/assignment.
  - Connection records (customer interactions and utility/grid communication logs).

## Outcome
- Implement the smallest correct change.
- Protect critical business rules with minimal unit tests.
- Keep token/runtime usage low.

## Workflow
1. Identify the business rule first.
2. Locate the exact module/service where the rule belongs.
3. Implement only the required code path.
4. Add focused tests only for critical logic.
5. Run build and only relevant tests.

## Design constraints
- Keep controllers thin; enforce rules in services/domain functions.
- Validate inputs at boundaries (DTO validation).
- Keep mutation flows explicit; avoid hidden side effects.
- Prefer deterministic logic and stable defaults.

## Minimal testing strategy
- Add tests only when logic can materially impact:
  - Revenue.
  - Compliance/auditability.
  - Customer journey or ownership integrity.

### Good tests
- Transition guards (e.g., lead -> qualified -> proposal -> closed).
- Authorization/ownership constraints.
- Deduplication and idempotency behavior.
- Time-sensitive SLA or reminder calculations.

### Avoid
- Boilerplate controller tests with no business value.
- Broad integration tests unless user asks.
- Over-mocking that hides rule behavior.

## Suggested command sequence
1. `npm run build`
2. `npm test -- <focused-spec-or-pattern>`

## Definition of done
- Build passes.
- Critical rule tests pass.
- No unnecessary tests or refactors added.
- Change summary explains business rule impact in 1-3 lines.

