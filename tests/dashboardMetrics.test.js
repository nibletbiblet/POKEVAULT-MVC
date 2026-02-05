const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRangeKey,
  getRangeWindow,
  computeDeltaPercent
} = require('../services/dashboardMetrics');

test('normalizeRangeKey defaults and normalizes', () => {
  assert.equal(normalizeRangeKey(), '7D');
  assert.equal(normalizeRangeKey('30d'), '30D');
  assert.equal(normalizeRangeKey('mtd'), 'MTD');
  assert.equal(normalizeRangeKey('invalid'), '7D');
});

test('computeDeltaPercent returns null when previous is zero', () => {
  assert.equal(computeDeltaPercent(100, 0), null);
  assert.equal(computeDeltaPercent(0, 0), null);
});

test('computeDeltaPercent calculates change correctly', () => {
  assert.equal(computeDeltaPercent(120, 100), 0.2);
  assert.equal(computeDeltaPercent(50, 100), -0.5);
});

test('getRangeWindow for 7D builds equal previous period', () => {
  const now = new Date(2026, 1, 5, 12, 0, 0);
  const range = getRangeWindow('7D', now);
  assert.equal(range.rangeKey, '7D');
  assert.equal(range.days.length, 7);
  assert.equal(range.prevDays.length, 7);
  assert.equal(range.days[0], '2026-01-30');
  assert.equal(range.days[6], '2026-02-05');
  assert.equal(range.prevDays[0], '2026-01-23');
  assert.equal(range.prevDays[6], '2026-01-29');
});

test('getRangeWindow for MTD starts at first of month', () => {
  const now = new Date(2026, 1, 5, 9, 30, 0);
  const range = getRangeWindow('MTD', now);
  assert.equal(range.days[0], '2026-02-01');
  assert.equal(range.days[range.days.length - 1], '2026-02-05');
  assert.equal(range.prevDays.length, range.days.length);
});
