"""
S5 Golden Vector Generator — R1 (rounding parity) empirical safety net.

Owner-frozen requirement (R1, S5 pre-implementation gate decision):
  "create empirical Python-derived Golden Vectors... Golden Vectors must
  include ordinary cases plus true rounding/tie-boundary cases capable of
  affecting PASS/BORDERLINE/FAIL outcomes... Python Reference remains
  authoritative... do not modify the Frozen Python Reference."

This script imports schemas/scoring_engine_reference_v2_3_1.py UNMODIFIED
and data/level_gates_v2_3_1.json UNMODIFIED, and writes
tests/s5/fixtures/golden_vectors.json containing:

  - capability_vectors: (technical, decision, pressure) -> capability_score()
    output, including deliberate rounding/tie-boundary stress cases.
  - classify_vectors: (level label, metrics, component_scores,
    evidence_confidence, match_transfer_score) -> classify() output, one
    per level per status (PASS/BORDERLINE/FAIL/LOW_CONFIDENCE/INCOMPLETE)
    plus explicit gate-boundary and missing-gate-metric cases.
  - validated_level_vectors: a shared input -> validated_level() output,
    including a genuine non-contiguous-PASS case and a no-PASS case.

Run once during S5 implementation:  python tests/s5/helpers/generate_golden_vectors.py
The output JSON is checked into the repo; the Python interpreter is NOT a
runtime or CI dependency of the S5 JS module or its tests.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCHEMAS = os.path.join(ROOT, 'schemas')
DATA = os.path.join(ROOT, 'data')
sys.path.insert(0, SCHEMAS)

import scoring_engine_reference_v2_3_1 as ref  # noqa: E402  (frozen reference — imported, never edited)

with open(os.path.join(DATA, 'level_gates_v2_3_1.json'), encoding='utf-8') as f:
    LEVEL_GATES = json.load(f)

LEVELS = LEVEL_GATES['levels']
LABELS = ["3.0", "3.5", "4.0", "4.5", "5.0"]


# ---------------------------------------------------------------------------
# 1. capability_score vectors (ordinary + rounding/tie-boundary stress)
# ---------------------------------------------------------------------------
def cap_vector(t, d, p, note):
    scores = {"technical_score": t, "decision_score": d, "pressure_score": p}
    return {
        "technical_score": t, "decision_score": d, "pressure_score": p,
        "expected_capability_score_0_100": ref.capability_score(scores),
        "note": note,
    }


capability_vectors = []

# ordinary cases
for (t, d, p, note) in [
    (80, 78, 75, "ordinary mid"),
    (60, 60, 60, "uniform 60"),
    (100, 100, 100, "uniform 100 (max)"),
    (0, 0, 0, "uniform 0 (min)"),
    (95, 75, 70, "4.0-shaped profile"),
    (61, 59, 57, "ordinary low"),
    (87.5, 82.3, 79.1, "fractional inputs"),
    (0, 100, 50, "spread / extreme weighting"),
    (33.3, 66.6, 99.9, "repeating-decimal inputs"),
]:
    capability_vectors.append(cap_vector(t, d, p, note))

# tie-boundary stress: for each level's capability_min, construct raw sums
# that land exactly at min + offset for offset in a set that spans the
# PASS/BORDERLINE/FAIL decision boundaries (0 and +/-5), plus true .X5
# rounding ties, by solving pressure_score algebraically for a fixed
# technical/decision pair.
def solve_pressure(target_raw, t, d):
    p = (target_raw - 0.45 * t - 0.30 * d) / 0.25
    return p


tie_offsets = [-5.05, -5.0, -4.95, -0.05, 0.0, 0.05, 4.95, 5.0, 5.05]
mins = sorted({cfg["capability_min"] for cfg in LEVELS.values()})
baseline_pairs = [(50, 50), (70, 65), (40, 90)]

for cmin in mins:
    for offset in tie_offsets:
        target = cmin + offset
        for (t, d) in baseline_pairs:
            p = solve_pressure(target, t, d)
            if 0 <= p <= 100:
                capability_vectors.append(cap_vector(
                    round(t, 4), round(d, 4), round(p, 6),
                    "boundary target raw={} (capability_min {} offset {})".format(target, cmin, offset)
                ))
                break  # one clamped-in-range solve per (cmin, offset) is enough

# true decimal-tie stress: raw sums landing on an exact .x5 at one-decimal
# resolution, scanned across a grid and picked for proximity to the tie.
best_ties = []
for ti in range(0, 101, 1):
    for di in range(0, 101, 7):
        for pi in range(0, 101, 11):
            raw = 0.45 * ti + 0.30 * di + 0.25 * pi
            frac_tenths = (raw * 10) % 1.0
            dist_to_half = min(abs(frac_tenths - 0.5), abs(frac_tenths - 1.5), abs(frac_tenths + 0.5))
            best_ties.append((dist_to_half, ti, di, pi))
best_ties.sort(key=lambda x: x[0])
seen = set()
count = 0
for dist, ti, di, pi in best_ties:
    key = (ti, di, pi)
    if key in seen:
        continue
    seen.add(key)
    capability_vectors.append(cap_vector(ti, di, pi, "decimal-tie stress dist={:.6f}".format(dist)))
    count += 1
    if count >= 15:
        break


# ---------------------------------------------------------------------------
# 2. classify() vectors — per level, per status, plus boundary/missing cases
# ---------------------------------------------------------------------------
LEVEL_METRIC_KEYS = {
    "3.0": {"serve_in_pct": 90, "return_in_pct": 85, "ue_per_game": 4},
    "3.5": {"serve_in_pct": 95, "return_quality_pct": 70, "drop_ball_quality_pct": 60,
            "reset_ball_quality_pct": 55, "shot_selection_pct": 70, "ue_per_game": 3},
    "4.0": {"serve_in_pct": 97, "return_quality_pct": 80, "drop_ball_quality_pct": 75,
            "reset_ball_quality_pct": 70, "shot_selection_pct": 85, "pressure_success_pct": 75,
            "ue_per_game": 2},
    "4.5": {"pattern_success_pct": 70, "attack_conversion_pct": 65, "transition_nvz_gain_pct": 75,
            "wrong_attack_pct": 10, "ue_per_game": 2},
    "5.0": {"rally_control_pct": 75, "pattern_adaptation_pct": 75, "neutralize_under_pressure_pct": 80,
            "attack_conversion_pct": 75, "ue_per_game": 1},
}

GOOD_COMPONENTS = {"technical_score": 92, "decision_score": 90, "pressure_score": 88}
GOOD_EVIDENCE_BY_LEVEL = {"3.0": "C4", "3.5": "C4", "4.0": "C4", "4.5": "C4", "5.0": "C4"}


def classify_case(label, metrics, component_scores, evidence, match_transfer_score, note):
    cfg = LEVELS[label]
    result = ref.classify(cfg, metrics, component_scores, evidence, match_transfer_score)
    return {
        "level_label": label,
        "metrics": metrics,
        "component_scores": component_scores,
        "evidence_confidence": evidence,
        "match_transfer_score": match_transfer_score,
        "expected": result,
        "note": note,
    }


classify_vectors = []

for label in LABELS:
    cfg = LEVELS[label]
    good_metrics = dict(LEVEL_METRIC_KEYS[label])
    good_evidence = GOOD_EVIDENCE_BY_LEVEL[label]
    good_match = 90 if cfg.get("match_validation") else None

    # (a) ordinary PASS
    classify_vectors.append(classify_case(
        label, good_metrics, GOOD_COMPONENTS, good_evidence, good_match,
        "ordinary PASS (all gates comfortably met, evidence sufficient, match ok if required)"
    ))

    # (b) INCOMPLETE — missing one component
    incomplete_components = dict(GOOD_COMPONENTS)
    incomplete_components["pressure_score"] = None
    classify_vectors.append(classify_case(
        label, good_metrics, incomplete_components, good_evidence, good_match,
        "INCOMPLETE — pressure_score missing"
    ))

    # (c) zero component preserved (not treated as missing)
    zero_components = dict(GOOD_COMPONENTS)
    zero_components["pressure_score"] = 0
    classify_vectors.append(classify_case(
        label, good_metrics, zero_components, good_evidence, good_match,
        "zero pressure_score is a real value, not INCOMPLETE"
    ))

    # (d) LOW_CONFIDENCE — evidence below level's evidence_min (use C1, always insufficient)
    classify_vectors.append(classify_case(
        label, good_metrics, GOOD_COMPONENTS, "C1", good_match,
        "LOW_CONFIDENCE — evidence C1 below evidence_min"
    ))

    # (e) missing gate metric — drop the first hard-gate key entirely; must never silently PASS
    first_gate_key = next(iter(cfg["hard_gates"].keys()))
    missing_metric_dict = dict(good_metrics)
    source_key = first_gate_key[:-4] if first_gate_key.endswith("_max") else first_gate_key
    missing_metric_dict.pop(source_key, None)
    classify_vectors.append(classify_case(
        label, missing_metric_dict, GOOD_COMPONENTS, good_evidence, good_match,
        "missing gate metric ({}) must not silently pass".format(first_gate_key)
    ))

    # (f) each individual gate boundary: exact threshold (pass) and one unit worse (fail)
    for gate_key, rule in cfg["hard_gates"].items():
        threshold = rule["threshold"]
        src_key = gate_key[:-4] if gate_key.endswith("_max") else gate_key
        at_boundary = dict(good_metrics)
        at_boundary[src_key] = threshold
        classify_vectors.append(classify_case(
            label, at_boundary, GOOD_COMPONENTS, good_evidence, good_match,
            "{} exact-threshold boundary (must PASS this gate)".format(gate_key)
        ))
        beyond = dict(good_metrics)
        beyond[src_key] = (threshold + 1) if gate_key.endswith("_max") else (threshold - 1)
        classify_vectors.append(classify_case(
            label, beyond, GOOD_COMPONENTS, good_evidence, good_match,
            "{} one-unit-worse (must FAIL this gate)".format(gate_key)
        ))

    # (g) BORDERLINE — capability within band below capability_min, gates/evidence/match still ok.
    # Solve component scores so weighted capability lands cmin - 2 (well inside the 5pp band).
    cmin = cfg["capability_min"]
    target_cap = cmin - 2
    # keep decision/pressure fixed, solve technical
    d_fixed, p_fixed = 70.0, 70.0
    t_solved = (target_cap - 0.30 * d_fixed - 0.25 * p_fixed) / 0.45
    t_solved = max(0, min(100, t_solved))
    borderline_components = {"technical_score": round(t_solved, 4), "decision_score": d_fixed, "pressure_score": p_fixed}
    classify_vectors.append(classify_case(
        label, good_metrics, borderline_components, good_evidence, good_match,
        "BORDERLINE — capability ~2pp below capability_min, all gates pass"
    ))

    # (h) FAIL — capability more than 5pp below capability_min (outside the band)
    target_cap_far = max(0, cmin - 10)
    t_far = (target_cap_far - 0.30 * d_fixed - 0.25 * p_fixed) / 0.45
    t_far = max(0, min(100, t_far))
    far_components = {"technical_score": round(t_far, 4), "decision_score": d_fixed, "pressure_score": p_fixed}
    classify_vectors.append(classify_case(
        label, good_metrics, far_components, good_evidence, good_match,
        "FAIL — capability >5pp below capability_min (outside borderline band)"
    ))

    # (i) match validation specific cases (only meaningful where match_validation is configured)
    if cfg.get("match_validation"):
        mv = cfg["match_validation"]
        min_mt = mv["min_match_transfer_score"]
        classify_vectors.append(classify_case(
            label, good_metrics, GOOD_COMPONENTS, good_evidence, min_mt,
            "match_transfer_score exact minimum boundary (must PASS match)"
        ))
        classify_vectors.append(classify_case(
            label, good_metrics, GOOD_COMPONENTS, good_evidence, min_mt - 1,
            "match_transfer_score one below minimum (must FAIL overall despite good gates/capability)"
        ))
        classify_vectors.append(classify_case(
            label, good_metrics, GOOD_COMPONENTS, good_evidence, None,
            "match_transfer_score missing entirely on a match-required level (must FAIL)"
        ))
    else:
        classify_vectors.append(classify_case(
            label, good_metrics, GOOD_COMPONENTS, good_evidence, None,
            "no match_validation configured for this level — match_transfer_score None must not affect outcome"
        ))
        classify_vectors.append(classify_case(
            label, good_metrics, GOOD_COMPONENTS, good_evidence, 1,
            "no match_validation configured for this level — a low match_transfer_score must not affect outcome"
        ))


# ---------------------------------------------------------------------------
# 3. validated_level() vectors — shared input evaluated across all 5 levels
# ---------------------------------------------------------------------------
def validated_case(metrics, component_scores, evidence, match_transfer_score, note):
    result = ref.validated_level(LEVELS, metrics, component_scores, evidence, match_transfer_score)
    level_results = {}
    for label in LABELS:
        r = ref.classify(LEVELS[label], metrics, component_scores, evidence, match_transfer_score)
        level_results[label] = r["status"]
    return {
        "metrics": metrics,
        "component_scores": component_scores,
        "evidence_confidence": evidence,
        "match_transfer_score": match_transfer_score,
        "expected_validated_training_level": result,
        "expected_level_results_status": level_results,
        "note": note,
    }


validated_level_vectors = []

# (a) everything comfortably passes every level -> highest label 5.0
all_pass_metrics = {}
for m in LEVEL_METRIC_KEYS.values():
    all_pass_metrics.update(m)
# push every metric comfortably past its toughest threshold across levels
all_pass_metrics.update({
    "serve_in_pct": 99, "return_in_pct": 95, "return_quality_pct": 95,
    "drop_ball_quality_pct": 95, "reset_ball_quality_pct": 95, "shot_selection_pct": 95,
    "pressure_success_pct": 95, "pattern_success_pct": 95, "attack_conversion_pct": 95,
    "transition_nvz_gain_pct": 95, "wrong_attack_pct": 1, "rally_control_pct": 95,
    "pattern_adaptation_pct": 95, "neutralize_under_pressure_pct": 95, "ue_per_game": 0.5,
})
validated_level_vectors.append(validated_case(
    all_pass_metrics, {"technical_score": 99, "decision_score": 99, "pressure_score": 99},
    "C4", 99, "all five levels PASS -> validated_training_level 5.0 (provisional levels still count)"
))

# (b) nothing passes -> None
validated_level_vectors.append(validated_case(
    {"serve_in_pct": 1}, {"technical_score": 1, "decision_score": 1, "pressure_score": 1},
    "C1", 1, "no level passes (evidence C1 always insufficient) -> validated_training_level None"
))

# (c) genuine non-contiguous PASS: 4.5's hard_gates are DISJOINT from 4.0's (the only metric key
# they share is ue_per_game_max) -- 4.5 checks pattern_success_pct/attack_conversion_pct/
# transition_nvz_gain_pct/wrong_attack_pct_max, none of which 4.0 requires, while 4.0 requires
# serve_in_pct/return_quality_pct/drop_ball_quality_pct/reset_ball_quality_pct/shot_selection_pct/
# pressure_success_pct, none of which 4.5 requires. So deliberately failing 4.0's gates (e.g. a low
# serve_in_pct, which 4.5 never even looks at) while satisfying 4.5's own disjoint gate set,
# capability_min (82), and evidence_min (C3) produces a REAL PASS-at-4.5 / FAIL-at-4.0-and-below
# case under the actual frozen level_gates_v2_3_1.json -- not merely a mechanism proof.
noncontig_metrics = {
    "serve_in_pct": 50,             # fails 3.0(>=85)/3.5(>=90)/4.0(>=95) -- 4.5 doesn't check this key at all
    "return_in_pct": 50,            # fails 3.0(>=80) too, for a clean "everything below 4.5 fails" picture
    "return_quality_pct": 50, "drop_ball_quality_pct": 50, "reset_ball_quality_pct": 50,
    "shot_selection_pct": 50, "pressure_success_pct": 50,   # all fail their 3.5/4.0 thresholds
    "pattern_success_pct": 90, "attack_conversion_pct": 90, "transition_nvz_gain_pct": 90,
    "wrong_attack_pct": 5,           # all comfortably satisfy 4.5's own gates
    "ue_per_game": 1,                # satisfies every level's ue_per_game_max (tightest is 4.5's <=4)
    "rally_control_pct": 50, "pattern_adaptation_pct": 50, "neutralize_under_pressure_pct": 50,
}
noncontig_components = {"technical_score": 95, "decision_score": 90, "pressure_score": 85}
noncontig_note = (
    "Genuine non-contiguous PASS under the ACTUAL frozen level_gates_v2_3_1.json: 4.5's hard_gates "
    "are disjoint from 4.0's (only ue_per_game_max is shared), so failing 4.0's gate set (serve_in_pct "
    "etc. driven to 50) while satisfying 4.5's own gate set, capability_min=82, and evidence_min=C3 "
    "produces expected_level_results_status == {3.0: FAIL, 3.5: FAIL, 4.0: FAIL, 4.5: PASS, 5.0: "
    "LOW_CONFIDENCE (needs C4, only C3 supplied)} and validated_training_level == 4.5, even though "
    "3.0/3.5/4.0 all FAIL. validated_level() computes each label via a fully independent classify() "
    "call with no cross-level state or lower-level-must-pass-first branch (confirmed by reading "
    "schemas/scoring_engine_reference_v2_3_1.py) -- this must be preserved and exposed as-is, per "
    "Owner-frozen R5, never silently corrected or normalized into a contiguous chain."
)
validated_level_vectors.append(validated_case(
    noncontig_metrics, noncontig_components, "C3", 90, noncontig_note
))


# ---------------------------------------------------------------------------
# write fixture
# ---------------------------------------------------------------------------
out = {
    "generated_from": "schemas/scoring_engine_reference_v2_3_1.py + data/level_gates_v2_3_1.json (both frozen, unmodified)",
    "generator": "tests/s5/helpers/generate_golden_vectors.py",
    "capability_vectors": capability_vectors,
    "classify_vectors": classify_vectors,
    "validated_level_vectors": validated_level_vectors,
}

out_path = os.path.join(ROOT, 'tests', 's5', 'fixtures', 'golden_vectors.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2, sort_keys=False)

print("wrote", out_path)
print("capability_vectors:", len(capability_vectors))
print("classify_vectors:", len(classify_vectors))
print("validated_level_vectors:", len(validated_level_vectors))
