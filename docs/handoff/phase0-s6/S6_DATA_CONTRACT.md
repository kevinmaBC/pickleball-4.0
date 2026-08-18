# S6 Data Contract

Preferred input:
```json
{"classification": {"...S5 result...": true}}
```

Output shape:
```json
{
  "explanation_version":"PB30-50-S6-EXPLAIN-v1",
  "target_level":4.0,
  "classification_status":"FAIL",
  "summary":{"reason_code":"HARD_GATE_FAIL","explanation":"..."},
  "capability":{"status":"PASS","observed":78.2,"required":76,"margin":2.2},
  "evidence":{"status":"PASS","input":"C3","minimum":"C3"},
  "hard_gates":[
    {"metric":"reset_ball_quality_pct","status":"FAIL","direction":"MIN","observed":61,"required":65,"margin":-4,"reason_code":"GATE_BELOW_MINIMUM"}
  ],
  "match_validation":{"required":true,"status":"PASS","observed":74,"minimum":70,"margin":4},
  "missing_inputs":[],
  "provisional":false,
  "blocking_reasons":[],
  "provenance":{"classifier_version":"PB30-50-S5-CLASSIFIER-v1","schema_version":"2.3.1","benchmark_version":"2.1.1"}
}
```

Proposed stable reason codes:
INCOMPLETE_INPUT, CAPABILITY_BELOW_MINIMUM, CAPABILITY_BORDERLINE,
EVIDENCE_BELOW_MINIMUM, HARD_GATE_FAIL, GATE_BELOW_MINIMUM,
GATE_ABOVE_MAXIMUM, MATCH_VALIDATION_FAIL, BORDERLINE_CLASSIFICATION,
PROVISIONAL_LEVEL, PASS_ALL_REQUIREMENTS.

Margin:
MIN gate => observed-required.
MAX gate => required-observed.
Positive=headroom; zero=boundary; negative=miss.
Margin is explanatory only, never bottleneck severity.
