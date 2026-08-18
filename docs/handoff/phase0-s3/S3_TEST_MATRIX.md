# S3 Test Matrix
T01 S2 ancestry
T02 S0 tests pass
T03 S1 tests pass
T04 S2 tests pass
T05 canonical 13/35 unchanged
T06 empty snapshot deterministic
T07 S/P/F/I counts exact
T08 total rates exact
T09 valid rates exact
T10 zero denominator => null
T11 session de-dup correct
T12 Drill grouping exact
T13 Drill→Master canonical mapping
T14 primary_kpi identifier exact
T15 secondary KPI parsing deterministic
T16 Drill order frozen
T17 all 13 Masters represented
T18 Master evidence coverage exact
T19 Master aggregate reconciles to Drill groups
T20 Master order frozen
T21 KPI groups derive only from canonical ids
T22 KPI Drill sets exact
T23 no KPI threshold/weight/score
T24 player filter
T25 date semantics proven
T26 session filter
T27 Drill filter
T28 Master filter
T29 unknown Drill surfaced
T30 Master mismatch surfaced
T31 same input deep-equal output
T32 stable sorting
T33 no PBStore writes/deletes/puts
T34 no IndexedDB schema/version change
T35 no scoring/recommendation/promotion/P0–P6
T36 script order
T37 SW cache update
T38 browser smoke + analytics available
T39 no npm/framework/server DB
T40 diff limited to S3

Required real-browser proof:
create/retain one player, at least 2 sessions, evidence across >=2 Drills in different Masters; run analytics; independently read raw IndexedDB; verify exact counts/rates and verify analytics did not mutate raw rows.
