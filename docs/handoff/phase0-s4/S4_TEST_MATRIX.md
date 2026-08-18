# S4 Test Matrix
T01 ancestry from S3
T02-T05 S0/S1/S2/S3 suites pass
T06 canonical 13/35 unchanged
T07 IndexedDB remains pb_v2 v2
T08 player_id required
T09 unknown player rejected
T10 known player not mutated
T11 no assessment => NONE
T12 one assessment selected
T13 assessment_date precedence
T14 created_at tie-break
T15 assessment_id final tie-break
T16 DB return order irrelevant
T17 stored assessment fields exact
T18 missing values not synthesized
T19 zero preserved vs null
T20 no score/validated-level/confidence computation
T21 DUPR pass-through only
T22 bottleneck/recommended_block pass-through only
T23 uses S3 rather than duplicate aggregation
T24 date semantics identical to S3
T25 no training evidence => NONE
T26 evidence => AVAILABLE
T27 S3 integrity propagated
T28 training analytics equals direct S3 call
T29 assessment yes/training no
T30 assessment no/training yes
T31 both
T32 neither
T33 all states deterministic
T34 no PBStore writes/deletes
T35 no IndexedDB schema change
T36 no scoring engine implementation
T37 no recommendation/prescription/P0–P6/promotion
T38 no S5
T39 script order
T40 SW cache
T41 no npm/framework/server DB
T42 diff limited to S4
T43 browser both-domains combined state exact
T44 browser training-only state exact
T45 browser assessment-only state exact
T46 repeated call deep-equal
T47 raw assessment/training records unchanged before/after
