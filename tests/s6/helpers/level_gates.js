'use strict';
/* Shared test helper — loads the frozen configuration authority
 * (data/level_gates_v2_3_1.json) once via fs, for use across tests/s6/.
 * Never modified; read-only. Mirrors tests/s5/helpers/level_gates.js. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const LEVEL_GATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'), 'utf8'));

module.exports = { ROOT, LEVEL_GATES };
