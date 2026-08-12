from typing import Dict, Any, Optional

EVIDENCE_RANK = {"C1":1, "C2":2, "C3":3, "C4":4}

def capability_score(scores: Dict[str, float]) -> Optional[float]:
    required = ("technical_score","decision_score","pressure_score")
    if any(scores.get(k) is None for k in required):
        return None
    return round(
        0.45*scores["technical_score"] +
        0.30*scores["decision_score"] +
        0.25*scores["pressure_score"], 1
    )

def _metric_pass(metric_key: str, rule: Dict[str, Any], metrics: Dict[str, float]) -> bool:
    threshold = rule["threshold"]
    if metric_key.endswith("_max"):
        source_key = metric_key[:-4]
        return metrics.get(source_key, float("inf")) <= threshold
    return metrics.get(metric_key, float("-inf")) >= threshold

def gate_pass(level_cfg: Dict[str, Any], metrics: Dict[str, float]) -> Dict[str, bool]:
    return {
        key: _metric_pass(key, rule, metrics)
        for key, rule in level_cfg["hard_gates"].items()
    }

def evidence_ok(level_cfg: Dict[str, Any], evidence: str) -> bool:
    return EVIDENCE_RANK[evidence] >= EVIDENCE_RANK[level_cfg["evidence_min"]]

def classify(level_cfg: Dict[str, Any], metrics: Dict[str, float],
             component_scores: Dict[str, float], evidence: str,
             match_transfer_score: Optional[float]=None) -> Dict[str, Any]:
    cap = capability_score(component_scores)
    if cap is None:
        return {"status":"INCOMPLETE","capability_score_0_100":None}
    gp = gate_pass(level_cfg, metrics)
    ev_ok = evidence_ok(level_cfg, evidence)
    match_cfg = level_cfg.get("match_validation")
    match_ok = True
    if match_cfg and match_cfg.get("required"):
        match_ok = (match_transfer_score is not None and
                    match_transfer_score >= match_cfg["min_match_transfer_score"])

    if not ev_ok:
        status = "LOW_CONFIDENCE"
    elif all(gp.values()) and cap >= level_cfg["capability_min"] and match_ok:
        status = "PASS"
    elif all(gp.values()) and abs(cap-level_cfg["capability_min"]) <= 5 and match_ok:
        status = "BORDERLINE"
    else:
        status = "FAIL"
    return {
        "capability_score_0_100": cap,
        "gate_results": gp,
        "evidence_ok": ev_ok,
        "match_validation_ok": match_ok,
        "status": status
    }

def validated_level(levels: Dict[str, Any], metrics: Dict[str, float],
                    component_scores: Dict[str, float], evidence: str,
                    match_transfer_score: Optional[float]=None) -> Optional[float]:
    passed = []
    for label in ("3.0","3.5","4.0","4.5","5.0"):
        cfg = levels[label]
        result = classify(cfg, metrics, component_scores, evidence, match_transfer_score)
        if result["status"] == "PASS":
            passed.append(float(label))
    return max(passed) if passed else None

def dupr_context(validated_training_level: Optional[float],
                 dupr_rating: Optional[float],
                 dupr_reliability: Optional[float]) -> str:
    if dupr_rating is None:
        return "No external DUPR evidence."
    if dupr_reliability is not None and dupr_reliability < 60:
        return "DUPR available but reliability is low; use as context only."
    return "DUPR is external competition evidence; do not subtract it from internal level."
