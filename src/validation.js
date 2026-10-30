import Ajv from "../vendor/ajv.js";
import weekSchema from "../schemas/week_plan.schema.json.js";
import bundleSchema from "../schemas/planning_bundle.schema.json.js";
import backupSchema from "../schemas/backup.schema.json.js";
import { addDays, isDate, monday, requiresHistoryPreservation } from "./model.js";
export const MAX_PLAN_BYTES = 2 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const ajv = new Ajv({ allErrors: true, jsonPointers: true });
ajv.addFormat('local-date', { type: 'string', validate: isDate });
ajv.addFormat('iso-time', { type: 'string', validate: (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) });
const validateWeek = ajv.compile(weekSchema), validatePlanning = ajv.compile(bundleSchema), validateBackup = ajv.compile(backupSchema);
function parse(raw, max) {
    if (new TextEncoder().encode(raw).byteLength > max)
        throw new Error(`Файл слишком большой. Максимум ${max / 1024 / 1024} МиБ.`);
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new Error('Не удалось прочитать JSON. Проверьте скобки, кавычки и отсутствие текста вокруг JSON.');
    }
}
function fail(check, label) { const first = check.errors?.slice(0, 3).map(e => `${e.dataPath || '/'}: ${e.message}`).join('; '); throw new Error(`${label} не соответствует поддерживаемой схеме. ${first ?? ''}`); }
const forbiddenIds = new Set(['__proto__', 'prototype', 'constructor']);
function safeId(id) { if (forbiddenIds.has(id))
    throw new Error('Недопустимый идентификатор занятия.'); }
export function parseWeekPlan(raw) {
    const value = parse(raw, MAX_PLAN_BYTES);
    if (!validateWeek(value))
        fail(validateWeek, 'План');
    const plan = value;
    if (monday(plan.weekStart) !== plan.weekStart)
        throw new Error('weekStart должен быть понедельником.');
    const end = addDays(plan.weekStart, 6), ids = new Set(), counts = {};
    for (const item of plan.sessions) {
        safeId(item.id);
        if (ids.has(item.id))
            throw new Error(`Повторяющийся id: ${item.id}.`);
        ids.add(item.id);
        if (item.date < plan.weekStart || item.date > end)
            throw new Error('Все занятия должны находиться внутри указанной недели.');
        if (item.kind === 'main') {
            counts[item.date] = (counts[item.date] ?? 0) + 1;
            if (counts[item.date] > 2)
                throw new Error('В обычный день допускается максимум два основных блока.');
            if (plan.restDates.includes(item.date))
                throw new Error('День с основным занятием нельзя одновременно отметить как отдых.');
        }
    }
    for (const date of plan.restDates)
        if (date < plan.weekStart || date > end)
            throw new Error('Дата отдыха находится вне недели.');
    return plan;
}
function validateSessionFacts(session) {
    const seen = new Set();
    let sum = 0;
    for (const entry of session.fact.timeEntries) {
        safeId(entry.id);
        if (seen.has(entry.id))
            throw new Error('Резервная копия содержит повторные записи времени.');
        seen.add(entry.id);
        sum += entry.minutes;
    }
    if (sum !== session.fact.actualMinutes)
        throw new Error('Сумма записей времени не совпадает с фактическими минутами.');
    if ((session.fact.taskOutcome === 'completed') !== (session.fact.completedAt !== null))
        throw new Error('Дата завершения не соответствует результату занятия.');
    if ((session.fact.taskOutcome === 'skipped') !== (session.fact.skippedAt !== null))
        throw new Error('Дата пропуска не соответствует результату занятия.');
    for (let i = 0; i < session.moves.length; i++) {
        const move = session.moves[i];
        if (move.from === move.to)
            throw new Error('Некорректная история переноса.');
        if (i && session.moves[i - 1].to !== move.from)
            throw new Error('Нарушена последовательность переносов.');
    }
    if (session.moves.length && session.moves.at(-1).to !== session.plan.date)
        throw new Error('Дата занятия не соответствует последнему переносу.');
}
export function validateState(value) {
    const envelope = { backupVersion: 2, exportedAt: new Date().toISOString(), state: value };
    if (!validateBackup(envelope))
        fail(validateBackup, 'Сохранённые данные');
    const state = value;
    if (monday(state.wizard.weekStart) !== state.wizard.weekStart)
        throw new Error('Неделя мастера должна начинаться в понедельник.');
    const validateStoredSession = (id, session) => {
        safeId(id);
        if (id !== session.plan.id)
            throw new Error('Идентификатор сохранённого занятия повреждён.');
        validateSessionFacts(session);
        if (session.importOrigin) {
            safeId(session.importOrigin.planId);
            if (monday(session.importOrigin.weekStart) !== session.importOrigin.weekStart)
                throw new Error('Некорректная исходная неделя занятия.');
        }
        if (session.importOrigin && session.legacyProvenanceUnknown)
            throw new Error('Происхождение занятия одновременно подтверждено и неизвестно.');
    };
    for (const [id, session] of Object.entries(state.sessions))
        validateStoredSession(id, session);
    for (const [id, record] of Object.entries(state.deletedSessions)) {
        validateStoredSession(id, record.session);
        if (Object.hasOwn(state.sessions, id))
            throw new Error('Занятие одновременно присутствует и удалено.');
        if (requiresHistoryPreservation(record.session) || record.session.cancelledAt)
            throw new Error('Нельзя хранить фактическую историю как удалённое пустое занятие.');
    }
    for (const [start, week] of Object.entries(state.weeks)) {
        safeId(week.planId);
        if (monday(start) !== start)
            throw new Error('Некорректная неделя в сохранённых данных.');
        for (const date of week.restDates)
            if (date < start || date > addDays(start, 6))
                throw new Error('Некорректная дата отдыха в сохранённых данных.');
        for (const id of week.sessionIds) {
            safeId(id);
            const session = state.sessions[id] ?? state.deletedSessions[id]?.session;
            if (!session || session.importOrigin?.weekStart !== start)
                throw new Error('Нарушена связь занятия с импортированной неделей.');
        }
    }
    for (const session of [...Object.values(state.sessions), ...Object.values(state.deletedSessions).map(r => r.session)]) {
        if (session.importOrigin) {
            const week = state.weeks[session.importOrigin.weekStart];
            if (!week || !week.sessionIds.includes(session.plan.id))
                throw new Error('Исходный план занятия отсутствует или повреждён.');
        }
    }
}
/** Validate the old shape first. Loading migrates only in memory; storage owns the protected write. */
export function migrateState(value) {
    if (value && typeof value === 'object' && value.version === 2) {
        validateState(value);
        return structuredClone(value);
    }
    const envelope = { backupVersion: 1, exportedAt: new Date().toISOString(), state: value };
    if (!validateBackup(envelope))
        fail(validateBackup, 'Сохранённые данные');
    const old = structuredClone(value);
    const next = { ...old, version: 2, deletedSessions: {}, weeks: {} };
    for (const session of Object.values(next.sessions))
        session.legacyProvenanceUnknown = true;
    for (const [start, week] of Object.entries(old.weeks))
        next.weeks[start] = { ...week, sessionIds: [], provenanceKnown: false };
    // A saved draft is the only v1 evidence of exact import membership; dates alone are insufficient.
    try {
        const draft = parseWeekPlan(old.wizard.importDraft), week = next.weeks[draft.weekStart];
        if (week && week.planId === draft.planId) {
            for (const plan of draft.sessions) {
                const session = next.sessions[plan.id];
                if (!session)
                    continue;
                const original = { ...session.plan, date: session.moves[0]?.from ?? session.plan.date };
                const keys = Object.keys(plan);
                if (keys.every(k => original[k] === plan[k]) && Object.keys(original).every(k => Object.hasOwn(plan, k))) {
                    session.importOrigin = { weekStart: draft.weekStart, planId: draft.planId };
                    delete session.legacyProvenanceUnknown;
                    week.sessionIds.push(plan.id);
                }
            }
            week.provenanceKnown = week.sessionIds.length === draft.sessions.length;
        }
    }
    catch { /* Missing, invalid or stale draft is not enough evidence; leave all records untouched. */ }
    validateState(next);
    return next;
}
export function validateBundle(value) {
    if (!validatePlanning(value))
        fail(validatePlanning, 'Набор для планирования');
    const bundle = value;
    if (monday(bundle.nextWeekStart) !== bundle.nextWeekStart || bundle.previousWeek.start !== addDays(bundle.nextWeekStart, -7) || bundle.previousWeek.end !== addDays(bundle.nextWeekStart, -1))
        throw new Error('Некорректные границы недель в наборе планирования.');
    for (const s of bundle.previousWeek.sessions)
        validateSessionFacts(s);
}
export function parseBackup(raw) {
    const value = parse(raw, MAX_BACKUP_BYTES);
    if (!validateBackup(value))
        fail(validateBackup, 'Резервная копия');
    return migrateState(value.state);
}
