# Repair progress implementation plan

Goal: Replace the PR-first dashboard with an issue list and wide detail view for direct AI-assisted repair.

Approved design: waiting for investigation → repairing → pending verification → verified. PR is optional. Code completion never implies deployment or recovery. Keep the existing release recurrence semantics and use “verified” rather than claiming an automatic observation window.

- [x] Add API regression tests for repair metadata persistence, ownership, invalid input, start transition, repeated events during repair, and stale verification reset.
- [x] Add a nullable JSON repair record and repairing lifecycle state to both stores. PATCH /api/issues/:id/repair accepts cause, summary, commitSha, deployment and verification text, with optional start action. Starting a new round clears old release markers; saving notes alone never changes lifecycle.
- [x] Replace PR panel/filter with a two-column layout and composable progress filters. Translate release actions, expose repair notes, retain optional collapsed PR editor. Refresh selected issue; handle failed writes without losing draft input.
- [x] Update operator/AI guides, both READMEs and decision log. Run full tests, types, lint and build plus sensitive-info checks.
- [ ] Integrate origin/master before commit and push; verify remote SHA. Back up the authorized test deployment, deploy collector plus dashboard, verify persistence and browser layout. Keep private deployment details outside Git.

Validation: 141 tests passed including real PostgreSQL integration; type-check, lint and full build passed. Browser verification is pending because the connected browser controller is unavailable. Deployment evidence is stored outside the public repository.
