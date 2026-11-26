const { localDay } = require('../shared.cjs');
const has = (value, key) => value[key] !== undefined;
function validDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('需要有效日期 YYYY-MM-DD');
  return value;
}
function boundary(date, end = false) {
  if (date == null) return null;
  const [year, month, day] = validDate(date).split('-').map(Number);
  const value = new Date(0); value.setFullYear(year, month - 1, day); value.setHours(0, 0, 0, 0);
  if (end) { value.setDate(value.getDate() + 1); return value.getTime() - 1; }
  return value.getTime();
}
const dateOf = value => value == null ? null : localDay(value);
function normalize(item) {
  const end = item.endAt ?? item.dueAt ?? null;
  return { ...item, startAt: item.startAt ?? null, endAt: end, dueAt: end, timeGranularity: item.timeGranularity ?? 'hour', startDate: item.startDate ?? null, endDate: item.endDate ?? null, tagId: item.tagId ?? null };
}
function schedule(input, previous = {}) {
  if (has(input, 'endAt') && has(input, 'dueAt') && input.endAt !== input.dueAt) throw Error('结束时间与截止时间必须一致');
  const timeGranularity = input.timeGranularity ?? previous.timeGranularity ?? 'hour';
  let startAt, endAt, startDate = null, endDate = null;
  if (timeGranularity === 'day') {
    startDate = has(input, 'startDate') ? validDate(input.startDate) : has(input, 'startAt') ? dateOf(input.startAt) : previous.startDate ?? dateOf(previous.startAt);
    const endInput = has(input, 'endAt') ? input.endAt : input.dueAt;
    const oldEnd = previous.endAt ?? previous.dueAt;
    const convertedEnd = previous.timeGranularity !== 'day' && previous.startAt != null && oldEnd > previous.startAt ? oldEnd - 1 : oldEnd;
    endDate = has(input, 'endDate') ? validDate(input.endDate) : has(input, 'endAt') || has(input, 'dueAt') ? dateOf(endInput) : previous.endDate ?? dateOf(convertedEnd);
    startAt = boundary(startDate); endAt = boundary(endDate, true);
    if ((has(input, 'startDate') && has(input, 'startAt') && input.startAt !== startAt) || (has(input, 'endDate') && (has(input, 'endAt') || has(input, 'dueAt')) && endInput !== endAt)) throw Error('日期与时间戳不一致');
  } else {
    if (input.startDate != null || input.endDate != null) throw Error('按日期安排时请使用 day 时间精度');
    startAt = has(input, 'startAt') ? input.startAt : previous.startAt ?? null;
    endAt = has(input, 'endAt') ? input.endAt : has(input, 'dueAt') ? input.dueAt : previous.endAt ?? previous.dueAt ?? null;
  }
  if (startAt != null && endAt != null && endAt < startAt) throw Error('结束时间不能早于开始时间');
  return { startAt, endAt, dueAt: endAt, timeGranularity, startDate, endDate };
}
module.exports = { schedule, normalize, validDate, boundary };
