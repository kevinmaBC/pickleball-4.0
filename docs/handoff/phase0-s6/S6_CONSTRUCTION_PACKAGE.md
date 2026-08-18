# S6 Construction Package

S6 implementation branch may be created only after S5 is committed/pushed/frozen.
Frozen S5 commit: `c5be57b`

Recommended branch:
`phase0-s6-assessment-explainability`

Preferred module:
`js/assessment-explainer.js`
Global:
`PBAssessmentExplainer`

Preferred API:
`explainClassification(s5Result)`

Consume S5 output; do not reproduce S5 classifier logic.
If S5 output lacks required observed/required values, PLAN must propose the smallest contract extension instead of duplicating S5.

No IndexedDB change, no PBStore writes, no threshold table duplication, no S7 work.
PLAN first; no git add/commit/push/merge before Owner acceptance.
