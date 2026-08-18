# S6 Architecture — Assessment Explanation & Evidence Trace Core

S0→S5 frozen stack → **S6 Explainability** → S7 Bottleneck Diagnostic → S8 Recommendation/Prescription → S9 P0–P6 → S10 UI/Governance.

S6 answers only: “Why did S5 return this classification?”

It explains S5 using:
- capability score vs minimum;
- hard-gate observed vs required values;
- evidence-confidence input vs minimum;
- match validation;
- missing inputs;
- BORDERLINE reason;
- provisional-level metadata;
- provenance.

S6 is not a second classifier. S5 `level_status` remains authoritative.

Evidence-confidence boundary:
S6 may explain Cx vs required Cy, but must not derive C1–C4 from sessions, dates, videos, games, rallies, or training evidence. Current evidence-confidence requirements are natural-language methodology; executable qualification belongs to a separately governed sprint/version.
