const VALID_RANGES = ['7D', '30D', 'MTD', 'YTD', 'ALL'];

function normalizeRangeKey(key) {
  if (!key) return '7D';
  const upper = String(key).toUpperCase();
  return VALID_RANGES.includes(upper) ? upper : '7D';
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(start, end) {
  const startMs = startOfDay(start).getTime();
  const endMs = startOfDay(end).getTime();
  return Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
}

function toYmd(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function enumerateDays(start, end) {
  if (!start || !end) return [];
  const days = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    days.push(toYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1));
  return d;
}

function getIsoWeekLabel(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const weekYear = d.getFullYear();
  const week1 = new Date(weekYear, 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${weekYear}-W${String(weekNum).padStart(2, '0')}`;
}

function enumerateWeeks(start, end) {
  if (!start || !end) return [];
  const weeks = [];
  let cursor = startOfWeek(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    const label = getIsoWeekLabel(cursor);
    weeks.push(label);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

function enumerateMonths(start, end) {
  if (!start || !end) return [];
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    const label = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    months.push(label);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function getRangeWindow(rangeKey, now = new Date()) {
  const key = normalizeRangeKey(rangeKey);
  const end = new Date(now);
  let start = null;
  let label = 'Last 7 days';

  if (key === '7D') {
    start = startOfDay(addDays(end, -6));
    label = 'Last 7 days';
  } else if (key === '30D') {
    start = startOfDay(addDays(end, -29));
    label = 'Last 30 days';
  } else if (key === 'MTD') {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
    label = 'Month to date';
  } else if (key === 'YTD') {
    start = new Date(end.getFullYear(), 0, 1);
    label = 'Year to date';
  } else if (key === 'ALL') {
    label = 'All time';
  }

  let prevStart = null;
  let prevEnd = null;
  let prevLabel = '';
  let days = [];
  let prevDays = [];

  if (start) {
    days = enumerateDays(start, end);
    const durationDays = Math.max(1, diffDays(start, end) + 1);
    prevEnd = start;
    prevStart = startOfDay(addDays(start, -durationDays));
    prevDays = enumerateDays(prevStart, addDays(prevEnd, -1));
    prevLabel = `Previous ${durationDays} days`;
  }

  return {
    rangeKey: key,
    rangeLabel: label,
    rangeStart: start,
    rangeEnd: end,
    prevStart,
    prevEnd,
    prevLabel,
    days,
    prevDays
  };
}

function computeDeltaPercent(current, previous) {
  const prev = Number(previous || 0);
  if (!prev) return null;
  return (Number(current || 0) - prev) / prev;
}

function buildValueMap(rows, valueKey) {
  const map = new Map();
  (rows || []).forEach(row => {
    if (!row) return;
    const key = row.bucket || row.day;
    if (!key) return;
    const dayKey = typeof key === 'string' ? key : toYmd(key);
    const value = Number(row[valueKey] || 0);
    map.set(dayKey, value);
  });
  return map;
}

function fillSeries(days, map, fallback = 0) {
  return (days || []).map(day => (map.has(day) ? map.get(day) : fallback));
}

module.exports = {
  VALID_RANGES,
  normalizeRangeKey,
  getRangeWindow,
  computeDeltaPercent,
  buildValueMap,
  fillSeries,
  toYmd,
  enumerateDays,
  enumerateWeeks,
  enumerateMonths
};
