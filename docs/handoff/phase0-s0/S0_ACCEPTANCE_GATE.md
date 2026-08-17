# S0 Acceptance Gate

S0 must satisfy **all** checks before S1 starts.

## Data integrity

- [ ] Exactly 13 Masters are persisted.
- [ ] Exactly 35 Drills are persisted.
- [ ] All 35 `source_drill_id` values are unique.
- [ ] All 13 `master_id` values are unique.
- [ ] Every Drill maps to exactly one frozen Master.
- [ ] No frozen source drill is missing.
- [ ] No extra drill was invented.
- [ ] Canonical seed validates against `seed_data.schema.json`.

## Source immutability

- [ ] Source-owned fields are loaded exactly from canonical seed.
- [ ] Application/runtime code cannot silently alter canonical `dose`.
- [ ] Application/runtime code cannot silently alter `progression`.
- [ ] Application/runtime code cannot silently alter `success_criterion`.
- [ ] Application/runtime code cannot silently alter KPI identity.
- [ ] Master membership is not changed by runtime behavior.

## Repository implementation

- [ ] Existing stack/package manager was preserved.
- [ ] Existing ORM/database/migration system was reused if present.
- [ ] Migration runs cleanly from a fresh database.
- [ ] Seed operation is idempotent or safely repeatable.
- [ ] Repository tests pass.
- [ ] README/docs state exact commands for migrate + seed + test.

## Minimal query contract

- [ ] `getMaster(master_id)` or repository equivalent works.
- [ ] `getDrill(source_drill_id)` or repository equivalent works.
- [ ] `getDrillsByMaster(master_id)` or repository equivalent works.

## Exit rule

When all items pass, stop. **Do not start S1.**
Return a concise completion report containing:

1. files changed;
2. migration/schema summary;
3. seed counts;
4. tests run + results;
5. any unresolved exception;
6. commit hash / branch if available.

Then wait for GitHub review.
