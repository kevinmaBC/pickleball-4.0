# PB APP 3.0–5.0 — MASTER CONTROL V2

Repository:
kevinmaBC/pickleball-4.0

Working Branch:
app-v2-alpha

Primary Stage Tracking:
Acceptance Commit SHA

Branch names are NOT the primary indicator of stage completion.

## Version Control Rules

```
VC-01
Every formally ACCEPTED major stage must record its exact
acceptance commit SHA in MASTER CONTROL V2.

VC-02
Branch names must not be used as the primary indicator
of stage completion.

VC-03
app-v2-alpha is the continuous working branch unless a
future frozen architecture decision explicitly changes it.

VC-04
Before a new implementation stage starts, its baseline
must trace to the latest accepted commit.

VC-05
Claude Code must STOP after each implementation package.
It may not autonomously begin the next stage.

VC-06
GPT Independent Acceptance is required before a stage
becomes ACCEPTED.

VC-07
If repository state conflicts with MASTER CONTROL,
implementation must STOP until reconciled.
```

## Stage Ledger

```
S7
Status: CLOSED / ACCEPTED
Acceptance Commit: 2f940c2
Acceptance Record: docs/S7-FINAL-ACCEPTANCE.md

S8
Status: CLOSED / ACCEPTED
Acceptance Commit: 8d1fec1
Acceptance Record: docs/S8-F-FINAL-QA.md

S9
Status: CLOSED / ACCEPTED
Acceptance Commit: 147de73
Acceptance Record: docs/S9-FINAL-ACCEPTANCE.md

S10-A
Status: CLOSED / ACCEPTED
Acceptance Commit: bd96b6c
Acceptance Record: docs/S10-A-WORKFLOW-INTEGRATION.md

S10-B
Status: CLOSED / ACCEPTED
Acceptance Commit: 4426250
Full SHA: 44262501ce29fab4a5345bcba24149b34285bbb7
Acceptance Records:
docs/S10-B-DASHBOARD-INTEGRATION.md
docs/S10-B-R1-DASHBOARD-UI-WIRING.md

S10-C
Status: CLOSED / ACCEPTED
Acceptance Commit: ca3e732
Full SHA: ca3e7322f8cd02210e9c6fb867742c4520e32f8e
Acceptance Record:
docs/S10-C-PRESCRIPTION-WORKFLOW.md

S10-D
Status: CLOSED / ACCEPTED
Acceptance Commit: 920eea4
Full SHA: 920eea4b9936c534e615aa277f115d55e0e21508
Core Commit: bab2382
Persistence R1 Commit: 920eea4
Acceptance Records:
docs/S10-D-SESSION-EVIDENCE.md
docs/S10-D-R1-DURABLE-PERSISTENCE.md

S10-D-R1
Status: CLOSED / ACCEPTED
Acceptance Commit: 920eea4

S10-E
Status: CLOSED / ACCEPTED
Acceptance Commit: 3050b1f
Full SHA: 3050b1f6725ac91e42c7d64e34f4516e3f095323
Blocking Audit Commit: 08de42a
Reason (historical): BASELINE RESOLUTION CONTRACT REQUIRED (no existing
accepted data path resolves development_cycle.baseline_ref into a
kpi_profile_code-keyed numeric baseline value — see
docs/S10-E-PROGRESS-REASSESSMENT.md for full repository evidence)
R1 Implementation Commit: 3050b1f
Acceptance Records:
docs/S10-E-PROGRESS-REASSESSMENT.md
docs/S10-E-R1-PROGRESS-REASSESSMENT.md

S10-E-R1
Status: CLOSED / ACCEPTED
Acceptance Commit: 3050b1f

S10-F
Status: CLOSED / ACCEPTED
Acceptance Commit: 947b41d
Full SHA: 947b41dd9581fcbaeec55913548c7edf89f21277
QA Record: docs/S10-F-CROSS-WORKFLOW-QA.md

KNOWN LIMITATION — MATCH PROGRESS
No durable kpi_profile_code-aligned MATCH Evidence store currently
exists. Therefore:
- numeric MATCH progress may remain UNRESOLVED / INSUFFICIENT_DATA;
- TRAINING Evidence must never be substituted for MATCH Evidence;
- real Match Observation remains valid for reassessment through S9;
- this limitation is non-blocking only while the system behaves
  honestly (never fabricates/infers a MATCH value from TRAINING data).

S10-FINAL
Status: CLOSED / ACCEPTED
Acceptance Commit: 4024f67
Full SHA: 4024f6773122a1b047605c583addb4ea07d84b18
Acceptance Record: docs/S10-FINAL-ACCEPTANCE.md

S10
Status: CLOSED / ACCEPTED
Final Acceptance Commit: 4024f67
Full SHA: 4024f6773122a1b047605c583addb4ea07d84b18

S11-A
Status: CLOSED / ACCEPTED
Acceptance Commit: e28c24c
Full SHA: e28c24c093bf050a8ce0a68e21cfaaa44f71ad6f
Acceptance Record: docs/S11-A-PRODUCT-JOURNEY-ORCHESTRATOR.md

S11-B
Status: CLOSED / ACCEPTED
Acceptance Commit: e06c0a0
Full SHA: e06c0a0451108bcee70ecd5a19ce3b0e94aa6552
Acceptance Record: docs/S11-B-HOME-PRIORITY-DASHBOARD.md

S11-C
Status: CLOSED / ACCEPTED
Acceptance Commit: fa05c70
Full SHA: fa05c7050c760e2dfe6945da11f865813d75f86a
Acceptance Record: docs/S11-C-GUIDED-TRAINING-ACTION-FLOW.md

S11-D
Status: CLOSED / ACCEPTED
Acceptance Commit: f9d9af3
Full SHA: f9d9af3c1086af276d656fffc651acf09faf15d7
Acceptance Record: docs/S11-D-PROGRESS-REASSESSMENT-EXPERIENCE.md

S11-E
Status: CLOSED / ACCEPTED
Acceptance Commit: aa507fb
Full SHA: aa507fb87d7568d97f2221a3318897de2f33eb2d
Acceptance Record: docs/S11-E-HISTORY-EXPLAINABILITY-RECOVERY.md

S11-F0
Status: BLOCKED — ROOT CAUSE REDEFINED
Audit Commit: 263b946
Primary Finding: MISSING_PRODUCTION_DECISION_REGISTRATION_ENTRY
Secondary Finding: PRESCRIPTION_WORKFLOW_CYCLE_LINK_MISSING
Audit Record: docs/S11-F0-PRESCRIPTION-LINEAGE-AUDIT.md

S11-F0-R1
Status: CLOSED / ACCEPTED
Acceptance Commit: 770667c
Full SHA:
770667cd2274eacd76b082c6a59053e8a396e25e
Acceptance Record:
docs/S11-F0-R1-PRODUCTION-REGISTRATION.md

S11-F ENTRY BLOCK:
CLEARED

S11-F-R1
Status: CLOSED / ACCEPTED
Acceptance Commit: c757d8f
Full SHA:
c757d8f5381ac0236d0a25752fe9f9cc34d8f9dd
Acceptance Record:
docs/S11-F-END-TO-END-PRODUCT-QA.md

S11-F
Status: CLOSED / ACCEPTED
Final Acceptance Commit: c757d8f
Full SHA:
c757d8f5381ac0236d0a25752fe9f9cc34d8f9dd
Acceptance Record:
docs/S11-F-END-TO-END-PRODUCT-QA.md

S11-FINAL
Status: IMPLEMENTED / GPT FINAL ACCEPTANCE PENDING
Implementation Record:
docs/S11-FINAL-ACCEPTANCE.md

S11
Status: FINAL ACCEPTANCE PENDING

R3B-1
Status: CLOSED / ACCEPTED
Acceptance Commit:
201dfde1810426b0e68a105f05477aab4da95882

POST-S11-R3B-2
Status: CLOSED / ACCEPTED
Acceptance Commit:
85f1c1e803ab7658214c1002d86c4eb2a30af6f8

POST-S11-R3B-3
Status: CLOSED / ACCEPTED
Acceptance Commit:
c523a23346204309f594926aadee607bb2306809
GPT Independent QA: PASS
RC-UAT: PASS
Full Regression: 50/50 PASS

POST-S11-R3B
Status: CLOSED / ACCEPTED

POST-S11-R4
Status:
ARCHITECTURE + DESIGN FROZEN

POST-S11-R4-A
Status: CLOSED / ACCEPTED
Acceptance Commit:
91178606c6cad4f33361b622f6226180fb1cf780
GPT Independent QA: PASS
Manual UAT: PASS
Full Regression: 51/51 PASS

POST-S11-R4-B
Status: CLOSED / ACCEPTED
Acceptance Commit:
97d0cb12bcec7573c3f03e3de4c3a2b05a76f12b
GPT Independent QA: PASS

POST-S11-R4-C
Name:
Assessment -> Action Handoff UX
Status: CLOSED / ACCEPTED
Acceptance Commit:
70435196e6a06ee006374de4fb19d7b721a03813
Baseline:
97d0cb12bcec7573c3f03e3de4c3a2b05a76f12b
AI Resource Control:
MEASURED
Scope:
Presentation + routing only, added to the R4-B Assessment
Result Summary as a new "Your Next Step" panel (Current
Priority / Why This Matters / Next Action / one primary CTA).
Every field is read verbatim from existing accepted sources
(PBHomeDashboardAdapter.loadHomeDashboard -> journey/focus/
next_action, PBHomeDashboardUI label/route helpers) — no new
diagnosis, recommendation, priority, prescription, Development
Cycle, validated level, or Match Transfer computation. No S9/
S10 engine changes, no Journey/HOME domain logic changes, no
DB schema changes. DB_VERSION unchanged (5), stores unchanged
(18/18).

POST-S11-R4-D
Name:
Release Candidate Full-System UAT / Final Product Readiness
Status:
CLOSED / ACCEPTED
Acceptance Commit:
4676e256f534dcef68ac6f0db52eb40ba578fbfd
Baseline:
70435196e6a06ee006374de4fb19d7b721a03813
AI Resource Control:
MEASURED
Scope:
Final release-acceptance gate only: added
tests/r4d-final-release-acceptance.test.js (FRG-01..FRG-08
governance/regression gate, no new product logic) and this
docs/R4-D-FINAL-RELEASE-ACCEPTANCE.md record. Manual UAT at
desktop and 375px surfaced one P1 mobile-overflow defect
(bottom nav last tab clipped off-screen at 375px, caused by
the R4-A/B-added #k-score-disclaimer text lacking min-width:0
as a flex child of .composite .lvl); fixed minimally with a
single min-width:0 CSS declaration in css/app.css, verified to
eliminate the overflow at 375px and 1280px with no other visual
change. No S9/S10 engine changes, no Journey/HOME domain logic
changes, no recommendation/priority/prescription logic changes,
no DB schema changes. DB_VERSION unchanged (5), stores unchanged
(18/18). See docs/R4-D-FINAL-RELEASE-ACCEPTANCE.md for the full
record.
Final Regression:
54 / 54 PASS
0 failures
Release Blocking Defects:
NONE OPEN
GPT Independent Final Acceptance:
PASS

POST-S11-R4 FINAL
Name:
Productization / Release Readiness Final Closure
Status:
CLOSED / ACCEPTED
Product Release Candidate:
PB-APP-RC1
Product Code Baseline:
4676e256f534dcef68ac6f0db52eb40ba578fbfd
Product Release Baseline:
FROZEN
Database:
DB_VERSION = 5
Stores = 18 / 18
Validated Levels:
3.0 / 3.5 / 4.0 / 4.5 / 5.0
Release Blocking Defects:
NONE OPEN
Final Regression:
54 / 54 PASS
0 failures
```

## Product Release Baseline

```
Product:
Drills Path from 3.0 to 5.0

Release Candidate:
PB-APP-RC1

Product Code Baseline:
4676e256f534dcef68ac6f0db52eb40ba578fbfd

Branch:
app-v2-alpha

R4:
CLOSED / ACCEPTED

Product Release Baseline:
FROZEN

Governance invariants:
- TRAINING Evidence != MATCH Evidence
- Progress != Validated Level
- Provisional Assessment Score != Validated Level
- Validated Levels remain: 3.0 / 3.5 / 4.0 / 4.5 / 5.0
- DB_VERSION remains 5
- Stores remain 18 / 18

Future changes are subject to Product Release Change Control.

The Product Code Baseline must NOT be redefined by later
governance/documentation commits.
```

## AI Resource Control V1

```
AI RESOURCE CONTROL V1
Status:
ACTIVE

For future controlled implementation stages, the Resource Ledger
should record where applicable:
- stage
- baseline SHA
- start timestamp
- end timestamp
- elapsed minutes
- commands run
- files added
- files modified
- test suites
- tests passed
- tests failed
- rework rounds
- commit SHA
```

S7 and S8 acceptance commit SHAs were confirmed directly from local Git
history (`git log --oneline`, cross-checked with `git show --stat`
against the exact acceptance doc each commit introduced) — not
reconstructed or guessed.

## S10-A Carry-Forward Requirement

```
FULFILLED BY S10-D / S10-D-R1
Acceptance Commit: 920eea4

S10-D MUST explicitly bridge:

Completed Training Session
→ generated TRAINING Evidence
→ ADD_EVIDENCE
→ Workflow reassessment eligibility

Session completion alone must not bypass the
Evidence → Reassessment loop.
```
