# S5 Construction Package

Frozen base: `cb8b67a5b9b28c34f64b4efe93ca61de08e49e23` on `phase0-s4-player-state`.
Recommended next branch after approval: `phase0-s5-assessment-classifier`.

Preferred new runtime:
`js/assessment-classifier.js`
Global: `PBAssessmentClassifier`.

Preferred API:
- calculateCapabilityScore(componentScores)
- classifyLevel(input, levelConfig)
- classifyTarget(input)
- validatedLevel(input)

Configuration authority:
`data/level_gates_v2_3_1.json`

Reference parity:
`schemas/scoring_engine_reference_v2_3_1.py`

Do not hard-code a divergent second copy of all thresholds if JSON can be reused.

Likely minimal runtime wiring:
- index.html: one script only if needed
- sw.js: cache/module/config asset only if needed

Frozen/unchanged:
S0–S4 logic, IndexedDB schema/version, prescription rules, CSS/UI, README unless separately authorized.

PLAN first. During implementation: no git add, commit, push, merge, or S6.
