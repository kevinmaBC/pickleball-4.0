# S4 Architecture
S0 Canonical → S1 Runtime → S2 Raw Evidence → S3 Analytics → S4 Player Training State → future S5+ decisions.

Preferred module: `js/player-training-state.js`, global `PBPlayerTrainingState`.
Dependencies: PBStore + PBCanonical + PBTrainingAnalytics.

Assessment remains formal evaluation authority.
Training analytics remains training-evidence authority.
S4 composes; neither silently overrides the other.
No new database, no derived-state persistence.
