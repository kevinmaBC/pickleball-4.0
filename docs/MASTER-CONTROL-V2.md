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
Status: IMPLEMENTED / GPT QA PENDING
Implementation Commit: see Git history / pending GPT acceptance
Implementation Record: docs/S10-B-DASHBOARD-INTEGRATION.md

S10-C
Status: PLANNED

S10-D
Status: PLANNED

S10-E
Status: PLANNED

S10-F
Status: PLANNED

S10-FINAL
Status: PLANNED
```

S7 and S8 acceptance commit SHAs were confirmed directly from local Git
history (`git log --oneline`, cross-checked with `git show --stat`
against the exact acceptance doc each commit introduced) — not
reconstructed or guessed.

## S10-A Carry-Forward Requirement (remains visible until S10-D acceptance)

```
S10-D MUST explicitly bridge:

Completed Training Session
→ generated TRAINING Evidence
→ ADD_EVIDENCE
→ Workflow reassessment eligibility

Session completion alone must not bypass the
Evidence → Reassessment loop.
```
