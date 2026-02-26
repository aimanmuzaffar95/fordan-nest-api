# AGENTS.md

## Project Scope
- Backend API for a solar CRM.
- Primary records:
  - Customers (homeowners/businesses, lead + account lifecycle).
  - Team (sales reps, installers, admins, support).
  - Connection records (calls, meetings, emails, status updates, utility/grid communication logs).

## Core Goal
- Keep CRM business logic correct and traceable while minimizing token and runtime cost.
- Prefer small, direct changes over broad refactors unless explicitly requested.

## Implementation Rules
- Keep modules separated by domain: `customers`, `team`, `connection-records`.
- Put business rules in services/domain functions, not controllers.
- Validate all external input with DTOs and explicit constraints.
- Favor explicit, readable code over abstraction-heavy patterns.

## Data Integrity Rules
- Never create or update records without required ownership/context fields.
- Keep audit fields consistent (`createdBy`, `updatedBy`, timestamps) when applicable.
- For connection records, preserve chronological integrity and actor/source metadata.

## Testing Policy (Important)
- Write minimal unit tests only for high-value business logic.
- Do not add broad or snapshot-heavy test suites.
- Skip trivial tests (framework wiring, simple pass-through controllers, getters/setters).
- Target only rules where a failure can cause revenue, compliance, or workflow issues.

### Must-test examples
- Status transition rules (invalid transitions blocked).
- Assignment/ownership rules (who can reassign customers or records).
- Duplicate prevention rules (customer/contact dedup logic).
- Critical calculations (pricing, capacity, commission, SLA windows) when introduced.

### Test budget guidance
- Prefer 1-3 focused tests per critical rule.
- Keep fixtures small and local.
- Use deterministic unit tests over integration/e2e unless specifically requested.

## Delivery Checklist
1. Build passes: `npm run build`
2. Relevant tests pass: `npm test -- <targeted spec>` (or closest equivalent)
3. No unrelated files changed
4. Changes documented in PR/summary with business impact

