# S4 Source Authority
Player identity: `PBStore.players`.
Assessment: `PBStore.assessments` and related assessment records.
Training observations: `PBTrainingAnalytics.computeSnapshot`.
Canonical metadata/version: `PBCanonical`.

If assessment field is missing, do not derive it from training analytics.
If training evidence is absent, do not derive it from assessment trials.
No silent synthesis or reconciliation.
