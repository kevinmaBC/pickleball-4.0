# S8-C: Session Execution Engine

`js/session-execution-engine.js` (`PBSessionExecution`) turns an existing
S8-B `SessionPlan` into a durable `SessionLog` via an explicit
START → ACTIVE → COMPLETE|PARTIAL|SKIPPED lifecycle. **It records what
happened; it does not judge, aggregate, or promote.** No adherence,
training-exposure score, `RETEST_READY`, validated-level change,
promotion, or cycle-effectiveness computation exists anywhere in this
module. It does not create `TrainingCycle`/`WeeklyPlan` (S8-B already
does that) and does not add UI (S8-E).

## Public API

```js
PBSessionExecution.startSession(session_plan_id, options?)
  // -> Promise<{ session_plan_id, week_plan_id, cycle_id, started_at }>

PBSessionExecution.completeSession(session_plan_id, executionPayload?)
PBSessionExecution.partialSession(session_plan_id, executionPayload?)
PBSessionExecution.skipSession(session_plan_id, skipPayload?)
  // -> Promise<SessionLog>  (the persisted record, with its real session_log_id)

PBSessionExecution.finalizeSession(session_plan_id, status, payload?)
  // generic form underlying the three above; status is 'COMPLETE' | 'PARTIAL' | 'SKIPPED'

PBSessionExecution.getSessionExecutionState(session_plan_id)
  // -> the in-memory active-session state, or null
```

`executionPayload` / `skipPayload` shape:
```js
{
  started_at: 'ISO 8601 string',   // optional; falls back to the active start state, else null
  completed_at: 'ISO 8601 string', // optional; defaults to now
  results: [ /* see Results below */ ],
  evidence_links: [ /* see Evidence Links below */ ],
  notes: 'string'
}
```

## Architectural decision: active execution state (Section 9)

An in-progress session is represented **only as in-memory runtime state**
(a plain object keyed by `session_plan_id`, module-local, not persisted).
No sixth IndexedDB store was added. `startSession` never touches
`SessionPlan` or creates any storage record — it only validates
eligibility and returns/stores this lightweight state. Only a final
outcome (`COMPLETE`/`PARTIAL`/`SKIPPED`) is ever written to storage, via
`PBStore.createSessionLog`. This was the brief's explicitly preferred
first implementation ("avoid adding a sixth IndexedDB store... unless
genuinely necessary") and keeps `Plan != Execution Log` trivially true:
`SessionPlan` is completely untouched during the entire active phase.

A consequence: the active state does not survive a process/page reload
(by design, for this first implementation). Finalizing (`completeSession`/
`partialSession`/`skipSession`) does **not** require a prior
`startSession` call in the same runtime — it looks up `started_at` from
the active state if one exists, or accepts it explicitly in the payload,
or leaves it `null` (relevant for `skipSession`, since a session can be
skipped without ever being started — Section 14).

## Session lifecycle

```
SessionPlan (status PLANNED | AVAILABLE)
    ↓ startSession()
  [in-memory active state — SessionPlan untouched]
    ↓ completeSession() | partialSession() | skipSession()
  SessionLog persisted (status COMPLETE | PARTIAL | SKIPPED)
    ↓
  SessionPlan.status synced (see below)
```

**`startSession`** (Section 9) performs, in order:
1. `SessionPlan` exists → else `SESSION_NOT_FOUND`.
2. `SessionPlan.status` is `PLANNED` or `AVAILABLE` → else `SESSION_NOT_STARTABLE`
   (covers Section 10: `COMPLETED`/`SKIPPED` plans are never auto-reopened).
3. Parent `WeeklyPlan` still exists → else `SESSION_NOT_STARTABLE`.
4. Parent `TrainingCycle` still exists → else `SESSION_NOT_STARTABLE`.
5. No finalized `SessionLog` already exists for this plan → else `SESSION_ALREADY_FINALIZED`.
6. No other active execution already in progress for this plan → else `SESSION_ALREADY_ACTIVE` (Section 23).

**Finalizing** (`finalizeSession`) checks, in order: `SessionPlan` exists
(`SESSION_NOT_FOUND`) → no finalized log already exists
(`SESSION_ALREADY_FINALIZED`, Section 8's single-final-log rule) →
payload shape valid (`INVALID_EXECUTION_PAYLOAD`) → timestamp order valid
(`INVALID_TIMESTAMP_ORDER`) → every `results`/`evidence_links` entry
matches a real `SessionPlan` assignment (`EXECUTION_ASSIGNMENT_MISMATCH`,
Section 20) → persist via `PBStore.createSessionLog` → sync
`SessionPlan.status`.

## COMPLETE / PARTIAL / SKIPPED meaning

- **`COMPLETE`** — the planned session was performed to completion *as an
  execution event*. It does **not** mean the success criterion passed, a
  hard gate passed, capability improved, or the player was promoted
  (Section 12). `criterion_met` (see Results below) is the only
  mechanically-derived judgment, and it stays scoped to that one result
  row.
- **`PARTIAL`** — some planned work was done, but the session was not
  completed in full. Never auto-upgraded to `COMPLETE` based on result
  values (Section 13). No `completion_fraction` field was added — Section
  13 explicitly allows keeping the architecture minimal when the field
  isn't necessary, and `results[]`/`notes` already capture whatever
  partial work happened without inventing a new aggregate number that
  S8-C isn't supposed to compute anyway.
- **`SKIPPED`** — an explicit durable record that the session did not
  happen. `results`/`evidence_links` are **always** persisted as `[]` for
  a `SKIPPED` log, even if a caller's payload tried to supply them — the
  engine silently discards them rather than fabricating execution
  evidence for something that didn't occur (Section 14). `started_at` is
  `null` when the session was skipped without ever being started.

No other status exists. `PASSED`/`FAILED`/`SUCCESS`/`PROMOTED`/`READY`
are never written to `SessionLog.status` (Section 11) — the field only
ever holds `COMPLETE` | `PARTIAL` | `SKIPPED`, matching S8-A's frozen
`SESSION_LOG_STATUSES` enum verbatim (no new enum value was introduced).

## SessionPlan / SessionLog separation

`SessionPlan` and `SessionLog` are always distinct records — this engine
never writes `results`, `evidence_links`, `notes`, `started_at`, or
`completed_at` onto a `SessionPlan` (S8-A's `updateSessionPlan` already
rejects those fields defensively; this engine additionally never even
attempts it). `SessionPlan.objective`, `.assignments`, `.sequence`,
`.week_plan_id`, and `.cycle_id` are never modified by this engine — the
only field ever changed is `.status` (Section 21).

**Status synchronization (Section 15):**

| SessionLog.status | SessionPlan.status |
|---|---|
| `COMPLETE` | `COMPLETED` |
| `PARTIAL` | `COMPLETED` |
| `SKIPPED` | `SKIPPED` |

S8-A's frozen `SessionPlan` status enum (`PLANNED | AVAILABLE | COMPLETED
| SKIPPED`) has no `PARTIAL` value, and Section 15 explicitly prefers not
adding one ("a consistent first implementation is preferred over enum
expansion"). This engine resolves that by defining `SessionPlan.status =
COMPLETED` to mean **"execution finalized"** (the planned slot is closed,
whether or not everything in it got done) — distinct from
`SessionLog.status = COMPLETE`, which specifically means "performed to
completion." Both `COMPLETE` and `PARTIAL` logs close the plan slot the
same way; only `SKIPPED` gets its own matching `SessionPlan.status`.

## Results structure (Section 16/17)

```json
{
  "assignment_index": 0,
  "assessment_namespace": "ASMT-05",
  "drill_id": "RESET_TRANSITION_BLOCK",
  "attempts": 20,
  "successful": 13,
  "measured_value": 65,
  "unit": "percent",
  "success_criterion": "reset_ball_quality_pct >= 50",
  "criterion_met": true
}
```

A caller may identify which assignment a result belongs to either by
`assignment_index` (position in `SessionPlan.assignments`) or by
`drill_id`/`assessment_namespace` (resolved against the plan's
assignments); the engine fills in `assessment_namespace`, `drill_id`, and
`success_criterion` from the matched assignment when the caller omits
them, so results stay tied to real plan content rather than
free-floating strings.

**`criterion_met`** (Section 17) is computed *mechanically and
unambiguously*: `SessionPlan.assignments[].success_criterion` is always
in the fixed `"<metric> >= <threshold>"` / `"<metric> <= <threshold>"`
format produced by S8-B's `buildAssignment`, so a simple regex parse
against a numeric `measured_value` is reliable. If `success_criterion` is
missing, unparseable, or `measured_value` isn't a number, `criterion_met`
is `null` — never guessed. **`criterion_met: true` carries no meaning
beyond that one result row** — it is not read anywhere as a Hard Gate
Passed, Validated Level change, or `RETEST_READY` signal (verified by a
structural test that the engine's code, comments stripped, never
references those terms).

## Evidence-link rules (Section 18)

```json
{
  "assessment_namespace": "ASMT-05",
  "source_type": "TRAINING_SESSION",
  "source_id": "sl_...",
  "drill_id": "RESET_TRANSITION_BLOCK",
  "metric": "reset_ball_quality_pct",
  "evidence_class": null
}
```

`source_id` can't be known until the `SessionLog` itself is persisted
(its id is generated inside `PBStore.createSessionLog`), so the engine
persists evidence links with `source_id: null` first, then does one
follow-up `PBStore.put('session_logs', ...)` to backfill the real
`session_log_id` into every entry — the same "read, patch, put" idiom
`js/retest-engine.js`'s `updatePrescriptionStatus` already uses, not a
new storage abstraction.

**`evidence_class` is always forced to `null`**, unconditionally — even
if a caller's payload supplies `'C2'` or any other value, the engine
discards it (verified in tests). No existing Master Control rule lets
training execution alone determine a C1–C4 confidence class; that
classification is an S7 review-engine concept computed from assessment
data, not from a training session log. Training execution never
auto-upgrades into validated assessment evidence.

## Namespace validation (Section 19)

Reuses `js/namespace.js` exclusively — no second normalizer. Any
`assessment_namespace` supplied by a caller is normalized via
`PBNamespace.toCanonical` when it's a recognized legacy `T0x` alias, left
as-is if already canonical (`ASMT-0x`), and left as-is (not guessed) if
unrecognized. Assignment-integrity comparisons (see below) normalize
before comparing, so a legacy-form namespace still correctly matches its
canonical-form counterpart already stored on the `SessionPlan`.

## Assignment integrity (Section 20)

Every `results[]`/`evidence_links[]` entry is validated against
`SessionPlan.assignments` before anything is persisted:
- If `assignment_index` is given, it must be a valid index into the
  plan's `assignments[]`, and any `drill_id`/`assessment_namespace` the
  entry also supplies must match that exact assignment.
- If no index is given but `drill_id`/`assessment_namespace` are, at
  least one assignment on the plan must match both.

Any mismatch rejects the whole finalize call with
`EXECUTION_ASSIGNMENT_MISMATCH` **before** any write — never a partial
persist of some valid + some invalid results.

## Error codes

| Code | When |
|---|---|
| `SESSION_NOT_FOUND` | unknown `session_plan_id` |
| `SESSION_NOT_STARTABLE` | `SessionPlan` not in `PLANNED`/`AVAILABLE`, or its parent `WeeklyPlan`/`TrainingCycle` no longer exists |
| `SESSION_ALREADY_ACTIVE` | `startSession` called again while already active for the same plan (Section 23) |
| `SESSION_ALREADY_FINALIZED` | a finalized `SessionLog` already exists for this plan (Section 8) |
| `INVALID_EXECUTION_PAYLOAD` | `results`/`evidence_links` not arrays, `notes` not a string, malformed timestamp, invalid `status` |
| `EXECUTION_ASSIGNMENT_MISMATCH` | a result/evidence entry doesn't correspond to a real plan assignment (Section 20) |
| `INVALID_TIMESTAMP_ORDER` | `completed_at` earlier than `started_at` (Section 22) |

## Explicit non-scope (unchanged from the task brief)

Adherence calculation, training-exposure aggregation, cycle progress
scoring, `RETEST_READY` calculation, `CycleSummary` engine, automatic
cycle completion (verified: completing every `SessionPlan` in a cycle
never changes `TrainingCycle.status`), automatic re-test generation,
validated-level change, promotion, Training UI, video/match analysis,
cloud sync/backend, coach features. None of these exist in
`js/session-execution-engine.js`. S8-D onward remains unstarted.
