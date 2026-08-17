# S2 Acceptance Gate

Upstream:
- [ ] based on S1 `2c26387`
- [ ] S0 tests ALL PASS
- [ ] S1 tests ALL PASS
- [ ] 13/35 unchanged

IndexedDB:
- [ ] pb_v2 upgraded v1→v2 additively
- [ ] existing four stores preserved
- [ ] representative old records survive browser upgrade
- [ ] training_sessions exists
- [ ] drill_evidence_events exists
- [ ] required indexes exist

API/evidence:
- [ ] create/end/list/export/delete session works
- [ ] delete cascades evidence
- [ ] canonical Drill required
- [ ] all 35 Drill IDs resolve
- [ ] Master derived from frozen membership
- [ ] conflicting Master cannot be forged
- [ ] S/P/F/I enforced
- [ ] invalid evidence rejected
- [ ] no full Drill definitions copied
- [ ] no scoring/recommendation/promotion written

Runtime/PWA:
- [ ] script order correct
- [ ] no startup errors
- [ ] SW version bumped and module cached
- [ ] existing app behavior preserved

Architecture/docs:
- [ ] no npm/external framework/server DB
- [ ] no S3 work
- [ ] README stale S1 statement corrected
- [ ] S2 completion report created

Verification:
- [ ] S2 tests ALL PASS
- [ ] browser smoke PASS
- [ ] real IndexedDB migration PASS
- [ ] git diff/status reviewed
- [ ] nothing committed/pushed before owner acceptance

End with `S2 COMPLETION RECOMMENDATION: PASS | PASS WITH CONDITIONS | FAIL`, then STOP.
