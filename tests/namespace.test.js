/* tests/namespace.test.js — S7-A: Canonical Assessment Namespace
 * Run: node tests/namespace.test.js
 */
var assert = require('assert');
var NS = require('../js/namespace.js');

// Legacy -> Canonical
assert.strictEqual(NS.toCanonical('T01'), 'ASMT-01');
assert.strictEqual(NS.toCanonical('T10'), 'ASMT-10');
assert.strictEqual(NS.toCanonical('T05'), 'ASMT-05');

// Canonical -> Canonical (idempotent passthrough)
assert.strictEqual(NS.toCanonical('ASMT-05'), 'ASMT-05');
assert.strictEqual(NS.toCanonical('ASMT-01'), 'ASMT-01');

// Unknown IDs must be safely rejected (null), never guessed
assert.strictEqual(NS.toCanonical('T11'), null);
assert.strictEqual(NS.toCanonical('ASMT-11'), null);
assert.strictEqual(NS.toCanonical('bogus'), null);
assert.strictEqual(NS.toCanonical(''), null);
assert.strictEqual(NS.toCanonical(null), null);
assert.strictEqual(NS.toCanonical(undefined), null);

// Canonical -> Legacy (reverse compatibility)
assert.strictEqual(NS.toLegacy('ASMT-01'), 'T01');
assert.strictEqual(NS.toLegacy('ASMT-10'), 'T10');
assert.strictEqual(NS.toLegacy('T03'), 'T03'); // idempotent passthrough
assert.strictEqual(NS.toLegacy('ASMT-99'), null);
assert.strictEqual(NS.toLegacy('nope'), null);

// Full T01..T10 -> ASMT-01..10 round trip
for (var i = 1; i <= 10; i++) {
  var legacy = 'T' + (i < 10 ? '0' + i : i);
  var canonical = 'ASMT-' + (i < 10 ? '0' + i : i);
  assert.strictEqual(NS.toCanonical(legacy), canonical, legacy + ' -> ' + canonical);
  assert.strictEqual(NS.toLegacy(canonical), legacy, canonical + ' -> ' + legacy);
}

// isLegacy / isCanonical
assert.strictEqual(NS.isLegacy('T01'), true);
assert.strictEqual(NS.isLegacy('ASMT-01'), false);
assert.strictEqual(NS.isCanonical('ASMT-01'), true);
assert.strictEqual(NS.isCanonical('T01'), false);

console.log('namespace.test.js: all assertions passed');
