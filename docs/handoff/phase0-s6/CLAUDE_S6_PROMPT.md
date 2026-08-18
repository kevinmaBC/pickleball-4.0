# S6 Frozen Baseline

Authoritative S5 frozen commit: `c5be57b`.
Before implementation, verify this commit is an ancestor of HEAD and stop if the repository baseline does not match.
Do not modify, reinterpret, or repair S5 behavior unless the Owner explicitly authorizes a minimal contract extension.

# Claude S6 Prompt — PLAN ONLY
Read all six S6 core files under `docs/handoff/phase0-s6/`.
Before planning, verify S5 is frozen and Owner supplies its exact commit; inspect S5 classifier/output/tests and run S0–S5 regression.

PLAN ONLY. Do not modify/create/delete/stage/commit/push/merge.

Plan must define:
1 exact S5 fields available;
2 whether S5 output is sufficient without reimplementing classification;
3 PBAssessmentExplainer API;
4 final reason-code enum;
5 summary-selection rule;
6 capability and MIN/MAX gate margin semantics;
7 missing-input semantics;
8 evidence-confidence explanation without derivation;
9 match/BORDERLINE/provisional explanations;
10 provenance;
11 CREATE/MODIFY/UNCHANGED files;
12 tests/browser proof;
13 Acceptance mapping;
14 risks/Owner decisions;
15 explicit proof no bottleneck/recommendation/prescription/P0–P6/promotion/S7.

If S5 output is insufficient, STOP and propose the smallest contract extension.

End exactly:
`S6 PLAN RECOMMENDATION: GO`
or `S6 PLAN RECOMMENDATION: GO WITH CONDITIONS`
or `S6 PLAN RECOMMENDATION: NO-GO`
Then STOP.
