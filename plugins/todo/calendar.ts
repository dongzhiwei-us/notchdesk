export type Todo = {
    id: string; title: string; notes?: string;
    startAt?: number | null; endAt?: number | null; dueAt?: number | null;
    status: 'pending' | 'in-progress' | 'completed'; snoozedUntil?: number | null;
    timeGranularity?: Granularity; startDate?: string | null; endDate?: string | null; tagId?: string | null;
};
export type Granularity = 'day' | 'hour';
export type TodoTag = { id: string; name: string };
export type ScheduleDraft = { timeGranularity: Granularity; startAt?: number; endAt?: number; startDate?: string; endDate?: string };
export const endOf = (item: Todo) => item.endAt ?? item.dueAt ?? null;
export function dayKey(value: number | Date = Date.now()) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dayDate(key: string) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
}
export function shiftDay(key: string, amount: number) {
    const date = dayDate(key); date.setDate(date.getDate() + amount); return dayKey(date);
}
export function weekOf(key: string) {
    const weekday = dayDate(key).getDay(); return shiftDay(key, -(weekday || 7) + 1);
}
export function dayNumber(value: number | Date) {
    const date = new Date(value);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}
export function todoSpan(item: Todo, week: string) {
    if (item.timeGranularity === 'day' && (item.startDate || item.endDate)) {
        const from = dayNumber(dayDate(item.startDate || item.endDate!)) - dayNumber(dayDate(week));
        const until = dayNumber(dayDate(item.endDate || item.startDate!)) - dayNumber(dayDate(week));
        if (until < 0 || from > 6) return null;
        return { from: Math.max(0, from), until: Math.min(6, until), before: from < 0, after: until > 6 };
    }
    const start = item.startAt ?? endOf(item);
    if (start == null) return null;
    const end = endOf(item) ?? start;
    const origin = dayNumber(dayDate(week));
    const from = dayNumber(start) - origin;
    // A range ending exactly at midnight does not occupy the next calendar day.
    const until = dayNumber(end > start ? end - 1 : end) - origin;
    if (until < 0 || from > 6) return null;
    return { from: Math.max(0, from), until: Math.min(6, until), before: from < 0, after: until > 6 };
}
export function hoursForDay(day: string) {
    const from = dayDate(day).getTime(), end = dayDate(shiftDay(day, 1)).getTime();
    const boundaries = [from];
    for (let next = from + 3600000; next < end; next += 3600000) boundaries.push(next);
    boundaries.push(end);
    return boundaries;
}
export function hourSpan(item: Todo, day: string) {
    let start = item.startAt ?? endOf(item), end = endOf(item) ?? start;
    if (item.timeGranularity === 'day' && (item.startDate || item.endDate)) {
        start = dayDate(item.startDate || item.endDate!).getTime();
        end = dayDate(shiftDay(item.endDate || item.startDate!, 1)).getTime();
    }
    if (start == null || end == null) return null;
    const origin = dayDate(day).getTime(), limit = dayDate(shiftDay(day, 1)).getTime();
    if (start >= limit || end < origin || (end === origin && end > start)) return null;
    return { from: Math.max(0, (start - origin) / (limit - origin)), until: Math.min(1, (end - origin) / (limit - origin)), before: start < origin, after: end > limit };
}
export function presetTimes(from: string, until = from) {
    const start = dayDate(from), end = dayDate(until);
    start.setHours(9); end.setHours(from === until ? 10 : 18);
    return { startAt: start.getTime(), endAt: end.getTime() };
}
