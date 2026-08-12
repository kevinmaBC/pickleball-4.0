CREATE TABLE players (
  player_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE assessments (
  assessment_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  assessment_date DATE NOT NULL,
  assessment_tier TEXT NOT NULL,
  target_training_level REAL NOT NULL,
  validated_training_level REAL,
  capability_score_0_100 REAL,
  technical_score REAL,
  decision_score REAL,
  pressure_score REAL,
  match_transfer_score REAL,
  evidence_confidence TEXT,
  primary_bottleneck TEXT,
  secondary_bottleneck TEXT,
  recommended_block_id TEXT,
  external_validation_note TEXT,
  benchmark_version TEXT NOT NULL DEFAULT '2.1.1',
  protocol_version TEXT NOT NULL DEFAULT '2.2.1',
  schema_version TEXT NOT NULL DEFAULT '2.3.1',
  FOREIGN KEY(player_id) REFERENCES players(player_id)
);

CREATE TABLE test_sessions (
  test_session_id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  assessment_tier TEXT NOT NULL,
  feed_mode TEXT,
  feeder_id TEXT,
  feeder_calibration_id TEXT,
  started_at TIMESTAMP,
  total_trials INTEGER,
  valid_trials INTEGER,
  primary_score REAL,
  secondary_score REAL,
  hard_gate_pass INTEGER,
  video_id TEXT,
  FOREIGN KEY(assessment_id) REFERENCES assessments(assessment_id)
);

CREATE TABLE trial_events (
  trial_event_id TEXT PRIMARY KEY,
  test_session_id TEXT NOT NULL,
  trial_no INTEGER NOT NULL,
  scenario_id TEXT,
  outcome TEXT,
  score_weight REAL,
  raw_json TEXT NOT NULL,
  review_flag INTEGER DEFAULT 0,
  video_timestamp_ms INTEGER,
  FOREIGN KEY(test_session_id) REFERENCES test_sessions(test_session_id)
);

CREATE TABLE rally_events (
  rally_event_id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  rally_no INTEGER NOT NULL,
  phase TEXT, intent TEXT, shot TEXT, target TEXT, quality TEXT, movement TEXT, result TEXT,
  pattern_id TEXT,
  adaptation_opportunity INTEGER DEFAULT 0,
  adaptation_success INTEGER,
  neutralize_opportunity INTEGER DEFAULT 0,
  neutralize_success INTEGER,
  control_state TEXT,
  review_flag INTEGER DEFAULT 0,
  timestamp_ms INTEGER,
  FOREIGN KEY(assessment_id) REFERENCES assessments(assessment_id)
);

CREATE TABLE dupr_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  singles_rating REAL, singles_reliability REAL,
  doubles_rating REAL, doubles_reliability REAL,
  mixed_rating REAL, source_mode TEXT,
  FOREIGN KEY(player_id) REFERENCES players(player_id)
);

CREATE TABLE prescriptions (
  prescription_id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  reason_metric TEXT,
  current_value REAL,
  target_value REAL,
  start_date DATE,
  earliest_review_date DATE,
  status TEXT,
  prerequisite_status TEXT,
  FOREIGN KEY(assessment_id) REFERENCES assessments(assessment_id)
);

CREATE TABLE feeder_calibrations (
  feeder_calibration_id TEXT PRIMARY KEY,
  feeder_id TEXT,
  feed_mode TEXT NOT NULL,
  calibration_date DATE,
  reference_level REAL,
  notes TEXT
);
