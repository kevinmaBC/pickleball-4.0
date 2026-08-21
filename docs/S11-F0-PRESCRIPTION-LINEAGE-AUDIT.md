# S11-F0 — Prescription Lineage Blocking Repair: Production Caller Audit

Stage: `S11-F0`
Status: `BLOCKING REPAIR IN PROGRESS`
Finding: `PRESCRIPTION_WORKFLOW_CYCLE_LINK_MISSING`

## 1. Blocking Finding

S11-E's read-only integrity check (`js/history-explainability-adapter.js`)
correctly flagged `ORPHAN_WORKFLOW_REF` for the manually-seeded QA
Prescription Workflow used during S11-B/S11-C/S11-D/S11-E manual
browser QA: the workflow's `prescription_ref` was never present in its
Development Cycle's `prescription_refs` array.

## 2. Root Cause (as framed by the frozen package, §3)

> S10-A Development Cycle contract owns `prescription_refs` and owns
> `GENERATE_PRESCRIPTION`. S10-C Prescription Workflow correctly owns
> its own lifecycle and must remain decoupled from S10-A. Current
> durable product registration persists the Prescription Workflow but
> does not execute the matching S10-A `GENERATE_PRESCRIPTION`
> transition on the Development Cycle.

This framing is not reinterpreted here. It is evaluated strictly
against this repository's actual state in §3 below, per the package's
own required Production Caller Audit (§6).

## 3. Production Caller Audit — Evidence

Exhaustive search of every `js/*.js` production file (excluding
`tests/*.js`) for any invocation of
`PBPrescriptionWorkflow.createPrescriptionWorkflow(...)`:

```
grep -rn "createPrescriptionWorkflow" js/
```

Results — every match:

| File | Line | Context |
|---|---|---|
| `js/prescription-workflow-engine.js:146` | function definition itself |
| `js/prescription-workflow-engine.js:266` | called only from `supersede()`, its own internal helper |
| `js/prescription-workflow-engine.js:286` | exported from the module's own return object |

**No other production file calls `createPrescriptionWorkflow` to
construct a new Prescription Workflow.** Every call site that *reads*
or *persists* an already-existing workflow object
(`js/guided-training-action-controller.js`'s `persistPrescriptionWorkflow`
calls, `js/progress-reassessment-persistence.js`'s `supersede`-related
writes) requires the workflow to already exist and be passed in by the
caller — none of them ever *create* one.

Further corroborating evidence, `js/review-ui.js:550` (its own existing,
accepted code comment, unchanged since S10-B):

> "No S10-A Workflow Cycle is persisted anywhere in this repo yet
> (S10-A shipped deliberately without persistence) ... `workflow` is
> left unset here."

And confirmed independently by `js/product-journey-orchestrator.js`'s
own S11-A documentation and by every S11-B/C/D/E stage's own
"Known Limitation" writeups: `recommendations`/`prescriptions` are
**never durably persisted anywhere** in this app — S9's own output is
computed fresh, in-memory, on every page load (`loadDashboard` pattern
in `js/review-ui.js` / `js/home-dashboard-adapter.js`), and no
production code path ever turns that transient S9 output into a
persisted S10-C Prescription Workflow.

**Conclusion: there is no identifiable production workflow-registration
caller in this repository today.** The Prescription Workflow objects
that triggered the `ORPHAN_WORKFLOW_REF` flag during manual QA were
created directly via `PBPrescriptionWorkflow.createPrescriptionWorkflow`
+ `PBStore.putPrescriptionWorkflow` calls issued from the browser
console during S11-B/C/D/E manual testing sessions — not through any
shipped application code path.

## 4. Why This Blocks the Repair As Framed

The frozen root cause (§2) describes a caller that "persists the
Prescription Workflow but does not execute the matching
`GENERATE_PRESCRIPTION` transition." That describes a caller which
*does* persist the workflow — just incompletely. The actual repository
state is one step further back: **no caller persists a
production-created workflow at all.** Building the durable
`registerPrescriptionWorkflowDurable`-equivalent API (§5 of the frozen
package) and then wiring it into a caller that does not exist would
require either (a) inventing a new UI/production entry point (explicitly
forbidden — "Do not invent a new UI subsystem"), or (b) wiring it into
an unrelated action such as Guided Training's session completion
(explicitly forbidden by name in §6: "Do not wire the repair into an
unrelated later action such as session completion").

Per §6's own explicit instruction for exactly this outcome:

> If there is no identifiable production workflow-registration caller:
> STOP. Verdict: BLOCKED. Reason: NO AUTHORIZED PRODUCTION REGISTRATION
> ENTRY FOUND. And report the evidence.

## 5. Scope Boundary Respected

Per this stage's explicit prohibitions, none of the following were
attempted as a workaround: adding a new store, incrementing
`DB_VERSION`, repairing historical data by inference, solving MATCH
persistence, solving durable S9 Recommendation persistence, solving
active-session persistence, or wiring the fix into session completion.

## 6. What Was Completed

- Baseline verified (`aa507fb` ancestor of HEAD, working tree clean).
- **Step 0**: `docs/MASTER-CONTROL-V2.md` updated — S11-E closed/accepted
  at `aa507fb`; S11-F0 entry added recording this blocking finding.
- **Step 3 (Production Caller Audit)**: completed exhaustively (§3
  above) — this is the deliverable of this stage's investigation.

## 7. What Was Not Implemented (and why)

The durable `registerPrescriptionWorkflowDurable`-equivalent API
(§5 of the frozen package) was **not** added to
`js/session-evidence-persistence.js` in this pass. Building a
GENERATE_PRESCRIPTION-delegating, idempotent registration API with no
real caller to exercise it would be untestable against genuine usage
and risks becoming exactly the kind of speculative, uncalled
"infrastructure for its own sake" this repo's engineering discipline
has consistently avoided at every prior stage (S9 through S11-E). Per
§6's explicit STOP instruction, implementation stops here pending GPT's
review of this audit.

## 8. Acceptance Gates (partial — audit only)

| Gate | Description | Status |
|---|---|---|
| F0-01 | S11-E accepted baseline lineage | PASS |
| F0-02 | MASTER CONTROL S11-E closure | PASS |
| F0-03–F0-13 | (repair-implementation gates) | NOT ATTEMPTED — see §7 |
| F0-14 | Full regression PASS (no regression introduced by this audit-only pass) | PASS |

## 9. Remaining Findings

`ORPHAN_WORKFLOW_REF` will continue to be correctly flagged (never
hidden, never auto-repaired) by S11-E's existing, unmodified integrity
check for any Prescription Workflow whose `prescription_ref` is not
linked into a Development Cycle's `prescription_refs` — this remains
honest and correct behavior given the current absence of any
production registration path.

Recommendation for GPT's consideration (not acted on here, no scope
broadened): before a `registerPrescriptionWorkflowDurable`-equivalent
API can meaningfully close this finding, a legitimate production
caller must first exist — i.e., a real UI/orchestration entry point
that takes S9's live-computed `recommendationResult`/
`prescriptionResult` output and durably registers a Prescription
Workflow against a Development Cycle. That caller does not exist yet
in any accepted stage (S11-A through S11-E). Defining and authorizing
that caller is itself a design decision outside this stage's narrow
"bridge the gap between an existing caller and S10-A" mandate.

## 10. Implementation Verdict

`BLOCKED` — no identifiable production workflow-registration caller
exists in this repository to route through the frozen S10-A
`GENERATE_PRESCRIPTION` bridge. This document records the required
Production Caller Audit evidence per §6 of the frozen S11-F0 package.
GPT owns the decision on how to proceed (e.g., authorizing a new
narrowly-scoped production registration caller in a future stage, or
redefining this finding's scope). This document does not self-declare
S11-F0 resolved, does not clear the S11-F entry block, and does not
authorize S11-F.
