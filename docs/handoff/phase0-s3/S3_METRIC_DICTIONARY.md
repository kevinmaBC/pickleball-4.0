# S3 Metric Dictionary
Base:
- trial_count_total
- outcome_S_count / P / F / I
- valid_trial_count = S+P+F
- session_count

If total>0:
S_rate_total=S/total; P_rate_total=P/total; F_rate_total=F/total; I_rate_total=I/total.
Else rates = null.

If valid>0:
S_rate_valid=S/valid; P_rate_valid=P/valid; F_rate_valid=F/valid.
Else rates = null.

Coverage:
master_count_total=13; master_count_with_evidence; master_count_without_evidence;
drill_count_total=35; drill_count_with_evidence; drill_count_without_evidence;
evidence_date_first; evidence_date_last.

Forbidden: weighted score, proficiency/capability/readiness/confidence score, pass/fail, bottleneck/priority score, recommendation, promotion.
