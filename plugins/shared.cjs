const { randomUUID } = require('node:crypto');

const text = (maxLength = 200, minLength = 1) => ({ type: 'string', minLength, maxLength });
const choice = (...values) => ({ type: 'string', enum: values });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const boolean = { type: 'boolean' };
const instant = { type: ['integer', 'null'], minimum: 0, maximum: 8640000000000000 };
const idSchema = text(128);

function action(ctx, method, description, properties, required, callback, options) {
  ctx.action(method, description, { type: 'object', properties, required, additionalProperties: false }, callback, options);
}

function rows(ctx) {
  return ctx.store.get('rows', []);
}

function save(ctx, value) {
  ctx.store.set('rows', value);
  return value;
}

function getRow(ctx, id) {
  const row = rows(ctx).find((item) => item.id === id);
  if (!row) throw new Error('找不到该条目');
  return row;
}

function change(ctx, id, update) {
  const row = { ...getRow(ctx, id), ...update, updatedAt: Date.now() };
  save(ctx, rows(ctx).map((item) => item.id === id ? row : item));
  return row;
}

function remove(ctx, id) {
  const previous = rows(ctx);
  const next = previous.filter((item) => item.id !== id);
  if (next.length !== previous.length) save(ctx, next);
  return { removed: next.length !== previous.length, id };
}

function record(fields, now = Date.now()) {
  return { id: randomUUID(), ...fields, createdAt: now, updatedAt: now };
}

function requiredText(value) {
  const clean = value.trim();
  if (!clean) throw new Error('请输入内容');
  return clean;
}

function localDay(now) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

function localTime(day, time) {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hour, minute).getTime();
}

module.exports = { action, text, choice, integer, boolean, instant, idSchema, rows, save, getRow, change, remove, record, requiredText, localDay, localTime };
