/* tests/match-observation-engine.test.js — S9-B: Match Observation Engine
 * Run: node tests/match-observation-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

var ROOT = path.join(__dirname, '..');
var levelGates = require(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'));
var t10Spec = require(path.join(ROOT, 'data', 'test_definitions_v2_3_1.json')).tests.T10;
var engineSrc = fs.readFileSync(path.join(ROOT, 'js', 'match-observation-engine.js'), 'utf8');
var assessmentSrc = fs.readFileSync(path.join(ROOT, 'js', 'assessment.js'), 'utf8');

function freshEnv() {
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/namespace.js')];
  global.PBNamespace = require('../js/namespace.js');
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/match-observation-engine.js')];
  global.PBMatchObservation = require('../js/match-observation-engine.js');
  return { PBStore: global.PBStore, PBNamespace: global.PBNamespace, PBMatchObservation: global.PBMatchObservation };
}

function assertRejects(promise, label, expectedCode) {
  return promise.then(
    function () { throw new Error('expected rejection but resolved: ' + label); },
    function (err) {
      assert.ok(err instanceof Error, label + ' rejects with an Error');
      if (expectedCode) assert.strictEqual(err.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + err.code + ')');
    }
  );
}

// A valid, minimal core rally payload; callers override game_number/rally_number/etc.
function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1,
    phase: 'transition', intent: 'neutralize', shot: 'reset', target: 'middle',
    quality: 'good', movement: 'balanced', result: 'continue',
    control_state: 'neutral'
  }, overrides || {});
}

function seedAssessmentAndSession(env, tier) {
  return env.PBStore.createPlayer('S9-B Test Player').then(function (player) {
    return env.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: tier || 'lite', target_training_level: 4.0 });
  }).then(function (assessment) {
    return env.PBMatchObservation.createMatchSession({
      assessment_id: assessment.assessment_id,
      assessment_tier: tier || 'lite',
      match_context: { observer_role: 'COACH', match_type: 'LEAGUE', format: 'DOUBLES' }
    }).then(function (session) { return { assessment: assessment, session: session }; });
  });
}

function addN(env, session_id, gamesCount, ralliesPerGame, rallyOverridesFn) {
  var chain = Promise.resolve();
  var results = [];
  for (var g = 1; g <= gamesCount; g++) {
    (function (g) {
      for (var r = 1; r <= ralliesPerGame; r++) {
        (function (r) {
          chain = chain.then(function () {
            var overrides = rallyOverridesFn ? rallyOverridesFn(g, r) : {};
            return env.PBMatchObservation.addRallyObservation(session_id, baseRally(Object.assign({ game_number: g, rally_number: r }, overrides)))
              .then(function (t) { results.push(t); });
          });
        })(r);
      }
    })(g);
  }
  return chain.then(function () { return results; });
}

function run() {
  var env, ctx;

  return Promise.resolve()

    // ==== A. ASMT-10 Match Observation Session accepted ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'lite');
    }).then(function (r) {
      ctx = r;
      assert.strictEqual(ctx.session.test_id, 'ASMT-10');
      assert.strictEqual(ctx.session.feed_mode, 'live_match');
    })

    // ==== B. Non-ASMT-10 session rejected ====
    .then(function () {
      return env.PBStore.createTestSession({ assessment_id: ctx.assessment.assessment_id, test_id: 'T01', feed_mode: 'machine' });
    }).then(function (t01session) {
      return assertRejects(env.PBMatchObservation.addRallyObservation(t01session.test_session_id, baseRally()), 'B: non-ASMT-10 session', 'NOT_MATCH_SESSION');
    })

    // ==== C. Non-live_match session rejected ====
    .then(function () {
      // Construct a raw test_sessions record with test_id=ASMT-10 but a different feed_mode,
      // bypassing createMatchObservationSession's own guard, to prove addRallyObservation
      // independently enforces feed_mode too (defense in depth).
      return env.PBStore.put('test_sessions', {
        test_session_id: 'ses_bad_feed', assessment_id: ctx.assessment.assessment_id,
        test_id: 'ASMT-10', feed_mode: 'partner', started_at: new Date().toISOString()
      });
    }).then(function () {
      return assertRejects(env.PBMatchObservation.addRallyObservation('ses_bad_feed', baseRally()), 'C: non-live_match session', 'NOT_LIVE_MATCH');
    })

    // ==== D. Valid rally observation persists through existing trial_events path ====
    // ==== E. One trial_event corresponds to one rally ====
    .then(function () {
      return env.PBMatchObservation.addRallyObservation(ctx.session.test_session_id, baseRally({ game_number: 1, rally_number: 1 }));
    }).then(function (trial) {
      assert.ok(trial.trial_event_id, 'D: rally persisted as a trial_event');
      return env.PBStore.trialsBySession(ctx.session.test_session_id);
    }).then(function (trials) {
      assert.strictEqual(trials.length, 1, 'E: exactly one trial_event for one addRallyObservation call');
      assert.strictEqual(trials[0].raw_json.game_number, 1);
      assert.strictEqual(trials[0].raw_json.rally_number, 1);
    })

    // ==== F. Duplicate game_number+rally_number rejected ====
    .then(function () {
      return assertRejects(
        env.PBMatchObservation.addRallyObservation(ctx.session.test_session_id, baseRally({ game_number: 1, rally_number: 1 })),
        'F: duplicate rally', 'DUPLICATE_RALLY'
      );
    })

    // ==== G. adaptation_success without opportunity rejected ====
    .then(function () {
      return assertRejects(
        env.PBMatchObservation.addRallyObservation(ctx.session.test_session_id, baseRally({
          game_number: 1, rally_number: 2, adaptation_opportunity: false, adaptation_success: true
        })),
        'G: adaptation_success without opportunity', 'INVALID_OBSERVATION'
      );
    })
    .then(function () {
      var v = engineRequireFresh().validateObservation(baseRally({ adaptation_opportunity: null, adaptation_success: true }));
      assert.strictEqual(v.valid, false, 'G (direct validateObservation): adaptation_success true with null opportunity is invalid');
    })

    // ==== H. neutralize_success without opportunity rejected ====
    .then(function () {
      return assertRejects(
        env.PBMatchObservation.addRallyObservation(ctx.session.test_session_id, baseRally({
          game_number: 1, rally_number: 3, neutralize_opportunity: false, neutralize_success: true
        })),
        'H: neutralize_success without opportunity', 'INVALID_OBSERVATION'
      );
    })

    // ==== I. Observer role provenance preserved ====
    .then(function () {
      return env.PBMatchObservation.getMatchContext(ctx.session.test_session_id);
    }).then(function (mc) {
      assert.strictEqual(mc.observer_role, 'COACH', 'I: observer_role provenance preserved on the session');
      assert.strictEqual(mc.match_type, 'LEAGUE');
      assert.strictEqual(mc.format, 'DOUBLES');
    })

    // ==== J. No automatic C1-C4 assignment ====
    // (Checks for an actual assigned rank literal, not the boundary-documenting prose comment
    // that explicitly says this engine must never assign one.)
    .then(function () {
      ["'C1'", "'C2'", "'C3'", "'C4'", "'C0'", 'evidence_confidence:', 'evidence_state:'].forEach(function (token) {
        assert.strictEqual(engineSrc.indexOf(token), -1, 'J: engine source must never assign ' + token);
      });
      return env.PBMatchObservation.computeMatchMetrics(ctx.session.test_session_id);
    }).then(function (metrics) {
      ['evidence_confidence', 'evidence_state', 'C1', 'C2', 'C3', 'C4'].forEach(function (k) {
        assert.strictEqual(Object.prototype.hasOwnProperty.call(metrics, k), false, 'J: computeMatchMetrics output must not carry ' + k);
      });
    })

    // ==== AB/AC/AD/AE: no Match Validation / validated level / CAP / Hard Gate output ====
    // (Checks for an actual assignment/output pattern, not the boundary-documenting prose
    // comment at the top of the file that explicitly says this engine must never produce these.)
    .then(function () {
      ['match_validation_state:', "state: 'MET'", "state: 'NOT_MET'", 'validated_training_level:',
       'capability_score:', 'CAP_WEIGHTS', 'hard_gate_passed:', 'hard_gate_failed:'].forEach(function (token) {
        assert.strictEqual(engineSrc.indexOf(token), -1, 'engine source must never assign/output ' + token);
      });
    })

    // ==== K. Lite boundary: 1 game / 20 rallies -> complete ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'lite');
    }).then(function (r) {
      ctx = r;
      return addN(env, ctx.session.test_session_id, 1, 20);
    }).then(function () {
      return env.PBMatchObservation.getObservationCompleteness(ctx.session.test_session_id);
    }).then(function (comp) {
      assert.strictEqual(comp.games_observed, 1);
      assert.strictEqual(comp.rallies_observed, 20);
      assert.strictEqual(comp.sample_complete, true, 'K: lite boundary (1 game/20 rallies) is complete');
    })

    // ==== N (lite). Below sample boundary -> incomplete (false, not null) ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'lite');
    }).then(function (r) {
      ctx = r;
      return addN(env, ctx.session.test_session_id, 1, 10);
    }).then(function () {
      return env.PBMatchObservation.getObservationCompleteness(ctx.session.test_session_id);
    }).then(function (comp) {
      assert.strictEqual(comp.sample_complete, false, 'N: below lite boundary is incomplete (false)');
    })

    // ==== N (unknown tier). No assessment_tier -> sample_complete null, not guessed ====
    .then(function () {
      env = freshEnv();
      return env.PBStore.createPlayer('P').then(function (p) {
        return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
      });
    }).then(function (a) {
      return env.PBMatchObservation.createMatchSession({ assessment_id: a.assessment_id }); // no assessment_tier passed
    }).then(function (session) {
      return env.PBMatchObservation.getObservationCompleteness(session.test_session_id);
    }).then(function (comp) {
      assert.strictEqual(comp.sample_target, null, 'unknown tier: sample_target must be null, not guessed');
      assert.strictEqual(comp.sample_complete, null, 'unknown tier: sample_complete must be null, not guessed');
    })

    // ==== L. Standard boundary: 3 games / 60 rallies -> complete ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'standard');
    }).then(function (r) {
      ctx = r;
      return addN(env, ctx.session.test_session_id, 3, 20);
    }).then(function () {
      return env.PBMatchObservation.getObservationCompleteness(ctx.session.test_session_id);
    }).then(function (comp) {
      assert.strictEqual(comp.games_observed, 3);
      assert.strictEqual(comp.rallies_observed, 60);
      assert.strictEqual(comp.sample_complete, true, 'L: standard boundary (3 games/60 rallies) is complete');
    })

    // ==== M. Full boundary: 5 games / 100 rallies -> complete ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'full');
    }).then(function (r) {
      ctx = r;
      return addN(env, ctx.session.test_session_id, 5, 20);
    }).then(function () {
      return env.PBMatchObservation.getObservationCompleteness(ctx.session.test_session_id);
    }).then(function (comp) {
      assert.strictEqual(comp.games_observed, 5);
      assert.strictEqual(comp.rallies_observed, 100);
      assert.strictEqual(comp.sample_complete, true, 'M: full boundary (5 games/100 rallies) is complete');
    })

    // ==== O/P/Q/R/S/T/U/V/W/X: metric formulas — no-denominator null + deterministic values ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'lite');
    }).then(function (r) {
      ctx = r;
      // Build a small, hand-computable fixture (game 1, 8 rallies):
      // rally 1: transition/attack, result attack_converted, quality good        -> attack success, transition success
      // rally 2: transition/attack, result continue, quality error              -> wrong attack, transition success (result != transition_lost/ue)
      // rally 3: nvz/neutralize, result ue, quality error, control_state none   -> UE, eligible(control) not controlled
      // rally 4: transition/neutralize, result transition_lost, quality neutral -> transition failure
      // rally 5: third/pressure, result winner, quality good, control pressure, pattern_id p1  -> pattern success, eligible+controlled
      // rally 6: nvz/pressure, result weak_reply, quality attackable, control attack, pattern_id p1, adaptation_opportunity true, adaptation_success true
      // rally 7: defense/neutralize, result winner, quality good, control neutral, neutralize_opportunity true, neutralize_success true
      // rally 8: serve/neutralize, result winner, quality good, control_state none (not eligible: phase=serve)
      var rallies = [
        { game_number: 1, rally_number: 1, phase: 'transition', intent: 'attack', result: 'attack_converted', quality: 'good', control_state: 'attack' },
        { game_number: 1, rally_number: 2, phase: 'transition', intent: 'attack', result: 'continue', quality: 'error', control_state: 'neutral' },
        { game_number: 1, rally_number: 3, phase: 'nvz', intent: 'neutralize', result: 'ue', quality: 'error', control_state: 'none' },
        { game_number: 1, rally_number: 4, phase: 'transition', intent: 'neutralize', result: 'transition_lost', quality: 'neutral', control_state: 'neutral' },
        { game_number: 1, rally_number: 5, phase: 'third', intent: 'pressure', result: 'winner', quality: 'good', control_state: 'pressure', pattern_id: 'p1' },
        { game_number: 1, rally_number: 6, phase: 'nvz', intent: 'pressure', result: 'weak_reply', quality: 'attackable', control_state: 'attack', pattern_id: 'p1', adaptation_opportunity: true, adaptation_success: true },
        { game_number: 1, rally_number: 7, phase: 'defense', intent: 'neutralize', result: 'winner', quality: 'good', control_state: 'neutral', neutralize_opportunity: true, neutralize_success: true },
        { game_number: 1, rally_number: 8, phase: 'serve', intent: 'neutralize', shot: 'serve', result: 'winner', quality: 'good', control_state: 'none' }
      ];
      var chain = Promise.resolve();
      rallies.forEach(function (r) {
        chain = chain.then(function () { return env.PBMatchObservation.addRallyObservation(ctx.session.test_session_id, baseRally(r)); });
      });
      return chain;
    }).then(function () {
      return env.PBMatchObservation.computeMatchMetrics(ctx.session.test_session_id);
    }).then(function (m) {
      // P: match_decision_pct — quality good|neutral: rallies 1,4,5,6(no,attackable),7,8 -> good/neutral count = 1,4(neutral),5,7,8 = 5 of 8
      assert.strictEqual(m.match_decision_pct, round1(5 / 8 * 100), 'P: match_decision_pct deterministic');
      // Q: match_transition_pct — transition-phase rallies: 1,2,4 (3 total); success = result not in {transition_lost,ue}: 1,2 succeed, 4 fails -> 2/3
      assert.strictEqual(m.match_transition_pct, round1(2 / 3 * 100), 'Q: match_transition_pct deterministic');
      // R: ue_per_game — 1 ue rally / 1 game observed
      assert.strictEqual(m.ue_per_game, 1, 'R: ue_per_game deterministic');
      // S: attack_conversion_pct — intent attack: rallies 1,2 (2 total); success = attack_converted: rally 1 only -> 1/2
      assert.strictEqual(m.attack_conversion_pct, round1(1 / 2 * 100), 'S: attack_conversion_pct deterministic');
      // T: pattern_success_pct — pattern_id set: rallies 5,6 (2 total); quality good: rally 5 only -> 1/2
      assert.strictEqual(m.pattern_success_pct, round1(1 / 2 * 100), 'T: pattern_success_pct deterministic');
      // U: wrong_attack_pct — attack intent: rallies 1,2; wrong (error|pop_up quality): rally 2 only -> 1/2
      assert.strictEqual(m.wrong_attack_pct, round1(1 / 2 * 100), 'U: wrong_attack_pct deterministic');
      // V: rally_control_pct — eligible (phase in third/transition/nvz/defense/finish): rallies 1,2,3,4,5,6,7 (7 total, excludes rally 8 serve);
      // controlled (control_state pressure|attack): rallies 1,5,6 -> 3/7
      assert.strictEqual(m.rally_control_pct, round1(3 / 7 * 100), 'V: rally_control_pct deterministic, does not fabricate beyond coded control_state');
      // W: pattern_adaptation_pct — adaptation_opportunity true: rally 6 (1 total); success true: rally 6 -> 1/1
      assert.strictEqual(m.pattern_adaptation_pct, 100, 'W: pattern_adaptation_pct uses explicit opportunity/success fields');
      // X: neutralize_under_pressure_pct — neutralize_opportunity true: rally 7 (1 total); success true: rally 7 -> 1/1
      assert.strictEqual(m.neutralize_under_pressure_pct, 100, 'X: neutralize_under_pressure_pct uses explicit opportunity/success fields');
    })

    // ==== O. No-opportunity denominators return null, not zero ====
    .then(function () {
      env = freshEnv();
      return seedAssessmentAndSession(env, 'lite');
    }).then(function (r) {
      ctx = r;
      // A single serve-phase, neutralize-intent rally with no pattern_id and no adaptation/neutralize opportunity coded.
      return env.PBMatchObservation.addRallyObservation(ctx.session.test_session_id, baseRally({
        game_number: 1, rally_number: 1, phase: 'serve', intent: 'neutralize', shot: 'serve', result: 'winner', quality: 'good', control_state: 'none'
      }));
    }).then(function () {
      return env.PBMatchObservation.computeMatchMetrics(ctx.session.test_session_id);
    }).then(function (m) {
      assert.strictEqual(m.attack_conversion_pct, null, 'O: attack_conversion_pct null with 0 attack opportunities');
      assert.strictEqual(m.wrong_attack_pct, null, 'O: wrong_attack_pct null with 0 attack opportunities');
      assert.strictEqual(m.pattern_success_pct, null, 'O: pattern_success_pct null with 0 pattern attempts');
      assert.strictEqual(m.pattern_adaptation_pct, null, 'O: pattern_adaptation_pct null with 0 adaptation opportunities');
      assert.strictEqual(m.neutralize_under_pressure_pct, null, 'O: neutralize_under_pressure_pct null with 0 neutralize opportunities');
      assert.strictEqual(m.match_transition_pct, null, 'O: match_transition_pct null with 0 transition-phase rallies');
      assert.strictEqual(m.rally_control_pct, null, 'O: rally_control_pct null with 0 eligible rallies (serve phase only)');
    })

    // ==== Y. Win/Loss never creates Match Validation state / never affects metrics ====
    .then(function () {
      var computeFnMatch = /function computeMatchMetrics\([\s\S]*?\n  \}/.exec(engineSrc);
      assert.ok(computeFnMatch, 'computeMatchMetrics function must be found in match-observation-engine.js');
      assert.strictEqual(computeFnMatch[0].indexOf('match_result'), -1, "Y: computeMatchMetrics must never branch on match_result (context-only field, set on match_context, never read by metric computation)");
      assert.strictEqual(computeFnMatch[0].indexOf('match_context'), -1, "Y: computeMatchMetrics must never read match_context (WIN/LOSS and all other context fields live there)");
      // Behavioral proof: two otherwise-identical sessions, one tagged WIN one tagged LOSS in match_context, produce identical metrics.
      env = freshEnv();
      return env.PBStore.createPlayer('WinPlayer').then(function (p) {
        return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
      });
    }).then(function (a) {
      return Promise.all([
        env.PBMatchObservation.createMatchSession({ assessment_id: a.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF', match_result: { result: 'WIN' } } }),
        env.PBMatchObservation.createMatchSession({ assessment_id: a.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF', match_result: { result: 'LOSS' } } })
      ]);
    }).then(function (sessions) {
      var winSession = sessions[0], lossSession = sessions[1];
      var rally = baseRally({ game_number: 1, rally_number: 1, result: 'ue', quality: 'error' });
      return Promise.all([
        env.PBMatchObservation.addRallyObservation(winSession.test_session_id, rally),
        env.PBMatchObservation.addRallyObservation(lossSession.test_session_id, rally)
      ]).then(function () {
        return Promise.all([
          env.PBMatchObservation.computeMatchMetrics(winSession.test_session_id),
          env.PBMatchObservation.computeMatchMetrics(lossSession.test_session_id)
        ]);
      });
    }).then(function (metricsPair) {
      var winMetrics = Object.assign({}, metricsPair[0], { session_id: null });
      var lossMetrics = Object.assign({}, metricsPair[1], { session_id: null });
      assert.deepStrictEqual(winMetrics, lossMetrics, 'Y: identical rally data produces identical metrics regardless of WIN/LOSS match_context');
    })

    // ==== Z / AA. Legacy T10-lite path + assessments.match_transfer.score untouched ====
    .then(function () {
      assert.ok(assessmentSrc.indexOf('function renderMatch()') !== -1, 'Z: T10-lite Match Entry screen must still exist, untouched');
      assert.ok(assessmentSrc.indexOf('function saveMatch(') !== -1, 'Z: saveMatch must still exist as the T10-lite write path');

      env = freshEnv();
      return env.PBStore.createPlayer('LegacyPlayer').then(function (p) {
        return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'standard', target_training_level: 4.0 });
      });
    }).then(function (a) {
      // Simulate the legacy T10-lite write path exactly as js/assessment.js saveMatch() does.
      return env.PBStore.updateAssessment(a.assessment_id, {
        ue: { games: 3, counts: { S: 2 } },
        match_transfer: { decision: 80, transition: 70, pressure: 60, attack: 90, score: 75 }
      }).then(function () { return a; });
    }).then(function (a) {
      ctx = { assessment: a };
      return env.PBMatchObservation.createMatchSession({ assessment_id: a.assessment_id, assessment_tier: 'standard', match_context: { observer_role: 'ANALYST' } });
    }).then(function (session) {
      return addN(env, session.test_session_id, 1, 20);
    }).then(function () {
      return env.PBStore.get('assessments', ctx.assessment.assessment_id);
    }).then(function (a) {
      assert.strictEqual(a.match_transfer.score, 75, 'AA: legacy assessments.match_transfer.score untouched by Full T10 rally capture');
      assert.strictEqual(a.match_transfer.decision, 80);
      assert.strictEqual(a.ue.games, 3, 'legacy assessments.ue untouched');
    })

    // ==== AF / AG. 4.0 threshold unchanged; 4.5/5.0 still no Match Validation rule ====
    .then(function () {
      assert.strictEqual(levelGates.levels['4.0'].match_validation.min_match_transfer_score, 70, 'AF: 4.0 threshold (70) unchanged');
      assert.strictEqual(levelGates.levels['4.0'].match_validation.required, true);
      ['4.5', '5.0'].forEach(function (lvl) {
        assert.strictEqual(levelGates.levels[lvl].match_validation, undefined, 'AG: ' + lvl + ' still has no match_validation rule');
        assert.strictEqual(levelGates.levels[lvl].status, 'provisional');
      });
    })

    // ---- Frozen sample plan mirrors T10 spec exactly ----
    .then(function () {
      var mo = engineRequireFresh();
      assert.deepStrictEqual(mo.SAMPLE_PLAN.lite, t10Spec.sample_plan.lite, 'SAMPLE_PLAN.lite mirrors data/test_definitions_v2_3_1.json exactly');
      assert.deepStrictEqual(mo.SAMPLE_PLAN.standard, t10Spec.sample_plan.standard, 'SAMPLE_PLAN.standard mirrors data/test_definitions_v2_3_1.json exactly');
      assert.deepStrictEqual(mo.SAMPLE_PLAN.full, t10Spec.sample_plan.full, 'SAMPLE_PLAN.full mirrors data/test_definitions_v2_3_1.json exactly');
    })

    .then(function () {
      console.log('match-observation-engine.test.js: all assertions passed');
    });
}

function round1(x) { return Math.round(x * 10) / 10; }

function engineRequireFresh() {
  delete require.cache[require.resolve('../js/match-observation-engine.js')];
  return require('../js/match-observation-engine.js');
}

run().catch(function (err) {
  console.error('match-observation-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
