# S10-D-R1: Durable S10 Persistence + Reload Idempotency

Follow-up to S10-D core (`bab2382`) after GPT Independent QA: "CORE
DOMAIN LOGIC: PASS, S10-A ADD_EVIDENCE BRIDGE: PASS, DURABLE
PERSISTENCE: NOT ACCEPTABLE YET." This rework's only authorized purpose
is to add durable S10 persistence and cross-reload idempotency — no
S10-D domain logic, no S9/S10-A/S10-C business rules, no UI, no S10-E.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at start): `bab2382` /
  `bab238241594da444565919065d8a05dcacbedfa` (S10-D core, GPT QA pending)
- Working tree at start: clean

## Why S8 persistence was not reused

`docs/S10-C-PRESCRIPTION-WORKFLOW.md` §6 and `docs/S10-D-SESSION-
EVIDENCE.md` §6 already established, with concrete source evidence,
that S8's `training_cycles`/`weekly_plans`/`session_plans`/
`session_logs` are FK-rooted in S7-A `review_snapshots`/`prescriptions`
(a CAP/bottleneck-periodization lineage) and that `js/training-plan-
engine.js` throws `INCOMPLETE_MAPPING` when a drill can't resolve — the
opposite of S9-F/S10-C/S10-D's frozen "UNRESOLVED is valid" rule. That
evidence is unchanged by this R1; forcing S10 records into those stores
would still corrupt both lineages' semantics. Per the frozen R1
architecture decision (§3), GPT approved four new, purpose-built,
S10-specific stores instead — this is the "new purpose-built store"
option that S10-D core's own persistence-decision section flagged as
requiring explicit GPT approval rather than self-authorization.

## DB_VERSION 3 → 4 (additive only)

`js/storage.js`'s `open()` upgrade path was already written generically
(`Object.keys(STORES).forEach(...) { if (!db.objectStoreNames.contains(name)) createObjectStore(...) }`)
— every prior version bump (S7-A v1→v2, S8-A v2→v3) used this same
additive-only mechanism, and this one does too. No existing store's
`keyPath`, indexes, or records are touched; nothing is deleted or
renamed. Test #40 proves the upgrade path only ever creates missing
stores (a structural scan for `deleteObjectStore` and for the
`if (!db.objectStoreNames.contains(name))` guard), and
`tests/storage.test.js` (extended, not rewritten, from its existing v1→v3
coverage) proves a database seeded at v3 with real records upgrades to
v4 with those records byte-identical.

## Four new stores

| Store | keyPath | Indexes | Durable source of truth for |
|---|---|---|---|
| `development_cycles` | `cycle_id` | `by_player`, `by_state` | S10-A `PBWorkflow` development cycles |
| `prescription_workflows` | `workflow_id` | `by_player`, `by_prescription`, `by_state` | S10-C `PBPrescriptionWorkflow` workflows |
| `session_results` | `session_id` | `by_player`, `by_prescription`, `by_status` | S10-D `PBSessionEvidence` completed Session Results |
| `training_evidence` | `evidence_id` | `by_player`, `by_session`, `by_prescription`, `by_source` | S10-D TRAINING Evidence |

CRUD in `js/storage.js` is thin `put`/`get`/`listBy*` wrappers around the
existing generic `put`/`get`/`getByIndex` helpers (§6's "do not
introduce a second storage abstraction") — the only validation added is
that each object's own `keyPath` field is present; no business rule is
re-implemented or re-checked in `storage.js` itself. The pure engines
(`PBWorkflow`/`PBPrescriptionWorkflow`/`PBSessionEvidence`) remain the
sole source of truth for every domain decision — this R1 only makes
their already-correct output durable.

## Durable orchestration: `js/session-evidence-persistence.js`

A thin service layer (`PBSessionEvidencePersistence`) composes
`PBStore`, `PBWorkflow`, and `PBSessionEvidence` — it implements no new
business rule of its own; every domain decision (numeric validation,
the Evidence Eligibility Gate, evidence identity, the resulting
workflow state) is still delegated verbatim to those engines. It only
decides *whether a given step needs to run at all*, by checking what is
already durably persisted, per §14's three replay cases:

- **Case A** (Session Result exists, Evidence missing): the existing
  Session Result is reused (never re-finalized); the Evidence step
  proceeds.
- **Case B** (Result + Evidence exist, cycle not updated): both are
  reused; `ADD_EVIDENCE` runs only if the persisted cycle doesn't
  already reference the evidence id.
- **Case C** (everything already linked): the call is fully idempotent
  — no writes happen, the already-consistent state is returned.

`js/prescription-workflow-engine.js` (S10-C) is untouched — per §8, its
persistence integration is two thin pass-through functions
(`persistPrescriptionWorkflow`/`reloadPrescriptionWorkflow`) that call
`PBStore.putPrescriptionWorkflow`/`getPrescriptionWorkflow` directly with
the plain object the pure engine already produces; no orchestration
logic sits between them because none is needed.

### Consistency strategy (non-atomic, documented per §13)

IndexedDB writes here are **not** wrapped in a single multi-store
transaction — `js/storage.js`'s existing `tx()`/`put()` helpers operate
one store at a time, and this R1 does not invent a new cross-store
transaction framework (explicitly out of scope). Steps run in the
documented deterministic order: verify no existing Session Result →
generate → persist → verify no existing Evidence → generate/persist →
`ADD_EVIDENCE` → persist updated cycle. If a later step fails, earlier
successfully-persisted records are never deleted (no invented
rollback), and the failure surfaces as an explicit rejected promise —
never a silently-claimed success. Because every step re-checks durable
state before acting, a retried call after a partial failure is
idempotent rather than destructive (proven in tests #25-27).

## Error vocabulary

`DUPLICATE_FINALIZATION`, `DUPLICATE_EVIDENCE`, `MISSING_DEVELOPMENT_CYCLE`
are reused verbatim from S10-D core's own codes (same meaning, now also
enforced against durable state, not just the caller's in-memory
objects). New to this layer: `PERSISTENCE_READ_FAILED` /
`PERSISTENCE_WRITE_FAILED` wrap any underlying `PBStore` promise
rejection so a real IndexedDB failure is never mistaken for "record not
found" — no silent persistence failure.

## Test evidence

`node tests/session-evidence-persistence.test.js` — all 40 §25 targeted
cases: schema/migration (1-8, including a genuine v3-seeded-database
upgrade proving old records survive byte-identical), CRUD (9-16),
durability across a *genuine* reload (17-20 — the JS runtime is fully
discarded and every module re-`require`d, while the shared
`fake-indexeddb` instance's own closure state is kept, exactly modeling
a real browser surviving a page reload while JS state does not; this is
explicitly not a `JSON.stringify`/`parse` round-trip, which was the gap
S10-D core was rejected for), cross-reload idempotency (21-24), recovery
after partial interruption (25-27), the durable S10-A bridge including
`REASSESSMENT_READY` reload survival (28-30), integrity/traceability
(31-34), and architecture protection (35-40, structural source scans).

`tests/storage.test.js` was extended (not rewritten) with the four new
stores' schema/CRUD assertions, following the exact pattern it already
used for its own S7-A→S8-A coverage. `tests/s9-a-match-architecture.test.js`
had two assertions comparing `PBStore.DB_VERSION`/store-count against a
hardcoded S9-A-era number (3 / 12 stores); these were updated to the
current repository baseline (4 / 16 stores) with a comment explaining
why — S9-A itself still adds zero stores, the baseline simply moved
later and independently.

Full regression: `node tests/*.test.js` — see commit report for the
exact suite count. No test's assertions were weakened; only the two
described version/count numbers were updated to match the new baseline.

## No S8 lineage pollution / no S10-E logic

Structural scans (tests #35-39) prove `js/session-evidence-persistence.js`
never references any S7/S8 store name, any S9 engine, `PBDashboard`, or
progress/trend vocabulary. No S10 record is ever written into
`session_logs`, `training_cycles`, `weekly_plans`, or `session_plans`.

## No UI change

Per §22, this R1 adds no UI. `js/session-evidence-persistence.js` is
not added to `index.html`'s script chain or `sw.js`'s `CORE` cache — it
is Node/test-only for now, exactly like `js/prescription-workflow-
engine.js` (S10-C) and `js/session-evidence-engine.js` (S10-D core)
were before any UI wiring existed for them. Wiring this into a UI
surface (e.g. "Complete Session" on the existing S10-B Recommendation/
Training Focus card) is a natural future follow-up, not something to
build speculatively here.

## Acceptance criteria self-check (not final acceptance — GPT owns that)

| # | Criterion | Status |
|---|---|---|
| 1 | DB_VERSION upgraded 3 → 4 | `js/storage.js` |
| 2 | Only four approved stores added | `development_cycles`/`prescription_workflows`/`session_results`/`training_evidence` |
| 3 | Migration is additive | Test #40, `tests/storage.test.js` v3-seed upgrade |
| 4 | Old records survive upgrade | `tests/storage.test.js`, `tests/session-evidence-persistence.test.js` #8 |
| 5 | Development Cycle durable | Tests #9/10/17 |
| 6 | Prescription Workflow durable | Tests #11/12/18 |
| 7 | Session Result durable | Tests #13/14/19 |
| 8 | TRAINING Evidence durable | Tests #15/16/20 |
| 9 | Cross-reload duplicate finalize protected | Tests #21/22 |
| 10 | Cross-reload duplicate evidence protected | Tests #23/24 |
| 11 | Recovery after partial write supported safely | Tests #25-27 |
| 12 | Evidence persisted before/with workflow bridge | `completeSessionDurable` step order (§13) |
| 13 | Updated development cycle persisted | Tests #25-27, #28 |
| 14 | REASSESSMENT_READY survives reload | Test #30 |
| 15 | No duplicate logical Evidence | Tests #23/24 |
| 16 | No duplicate logical Session Result | Tests #21/22 |
| 17 | No S7/S8 fake lineage | Tests #35/36 |
| 18 | No writes into S8 session_logs for S10 data | Test #37 |
| 19 | No S9/S10-A/S10-C business logic changes | No production file of theirs modified; test #38 |
| 20 | No S10-E progress logic | Test #39 |
| 21 | Targeted tests PASS | `session-evidence-persistence.test.js` |
| 22 | Full/relevant regression PASS | See commit report |
| 23 | MASTER CONTROL remains GPT QA pending | `docs/MASTER-CONTROL-V2.md` |
| 24 | Claude STOPPED before S10-E | This report is the stop point |

## Implementation Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
