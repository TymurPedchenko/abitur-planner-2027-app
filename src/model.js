export function localDate(date = new Date()) {
    return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}
export function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const d = new Date(`${value}T12:00:00`);
    return Number.isFinite(d.getTime()) && localDate(d) === value;
}
export function addDays(date, days) {
    if (!isDate(date) || !Number.isInteger(days))
        throw new Error('Некорректная календарная дата.');
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    return localDate(d);
}
export function monday(date) {
    if (!isDate(date))
        throw new Error('Некорректная календарная дата.');
    const day = new Date(`${date}T12:00:00`).getDay();
    return addDays(date, -(day === 0 ? 6 : day - 1));
}
export function nextMonday(date) { return addDays(monday(date), 7); }
export function emptyState(today = localDate()) {
    return { version: 1, revision: 0, sessions: {}, weeks: {}, wizard: { step: 1, weekStart: nextMonday(today), informatik: { text: '', unavailable: false }, mathematik: { text: '', unavailable: false }, preferences: '', importDraft: '' } };
}
export function makeSession(plan) {
    return { plan: structuredClone(plan), fact: { actualMinutes: 0, timeEntries: [], taskOutcome: 'not_started', completedAt: null, skippedAt: null, notes: '' }, moves: [] };
}
export function progress(actual, planned) { return planned > 0 ? Math.min(100, Math.max(0, Math.round(actual / planned * 100))) : 0; }
function validMinutes(minutes) { if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    throw new Error('Введите целое число минут от 1 до 1440.'); }
export function addTime(session, minutes, entryId = crypto.randomUUID(), date = session.plan.date) {
    validMinutes(minutes);
    if (!isDate(date))
        throw new Error('Укажите корректную дату записи времени.');
    if (session.fact.timeEntries.some(entry => entry.id === entryId))
        throw new Error('Эта запись времени уже сохранена.');
    if (!entryId || entryId.length > 120)
        throw new Error('Некорректный идентификатор записи.');
    const next = structuredClone(session);
    next.fact.timeEntries.push({ id: entryId, minutes, createdAt: new Date().toISOString(), date });
    next.fact.actualMinutes += minutes;
    return next;
}
export function removeTime(session, entryId) {
    if (!session.fact.timeEntries.some(entry => entry.id === entryId))
        throw new Error('Запись времени не найдена.');
    const next = structuredClone(session);
    next.fact.timeEntries = next.fact.timeEntries.filter(entry => entry.id !== entryId);
    next.fact.actualMinutes = next.fact.timeEntries.reduce((sum, entry) => sum + entry.minutes, 0);
    return next;
}
export function setOutcome(session, outcome) {
    if (!['not_started', 'continue', 'completed', 'difficulty', 'skipped'].includes(outcome))
        throw new Error('Неизвестный результат занятия.');
    const next = structuredClone(session);
    const now = new Date().toISOString();
    next.fact.taskOutcome = outcome;
    next.fact.completedAt = outcome === 'completed' ? (next.fact.completedAt ?? now) : null;
    next.fact.skippedAt = outcome === 'skipped' ? (next.fact.skippedAt ?? now) : null;
    return next;
}
export function moveSession(session, date) {
    if (!isDate(date))
        throw new Error('Укажите корректную дату переноса.');
    if (session.fact.taskOutcome === 'completed')
        throw new Error('Завершённое занятие нельзя переносить.');
    const next = structuredClone(session);
    if (date !== session.plan.date) {
        next.moves.push({ from: session.plan.date, to: date, movedAt: new Date().toISOString() });
        next.plan.date = date;
    }
    return next;
}
export function hasFact(session) { return session.fact.actualMinutes > 0 || session.fact.timeEntries.length > 0 || session.fact.taskOutcome !== 'not_started' || session.fact.notes.trim().length > 0; }
export function stats(state, from, to) {
    const sessions = Object.values(state.sessions), all = sessions.filter(s => s.plan.date >= from && s.plan.date <= to), main = all.filter(s => s.plan.kind === 'main');
    const result = { plannedMinutes: 0, actualMinutes: 0, progress: 0, completed: 0, unfinished: 0, skipped: 0, unmarkedDays: [], moved: 0, bySubject: { Informatik: 0, Mathematik: 0, Spanisch: 0 }, quizletMinutes: 0, simpleclubMinutes: 0 };
    let credited = 0;
    for (const s of main) {
        result.plannedMinutes += s.plan.plannedMinutes;
        const minutes = s.fact.timeEntries.filter(e => e.date >= from && e.date <= to).reduce((n, e) => n + e.minutes, 0);
        credited += Math.min(minutes, s.plan.plannedMinutes);
        if (s.fact.taskOutcome === 'completed')
            result.completed++;
        else if (s.fact.taskOutcome === 'skipped')
            result.skipped++;
        else
            result.unfinished++;
    }
    for (const s of sessions) {
        const minutes = s.fact.timeEntries.filter(e => e.date >= from && e.date <= to).reduce((n, e) => n + e.minutes, 0);
        if (s.plan.kind === 'main') {
            result.actualMinutes += minutes;
            result.bySubject[s.plan.subject] += minutes;
        }
        else if (s.plan.kind === 'quizlet')
            result.quizletMinutes += minutes;
        else
            result.simpleclubMinutes += minutes;
    }
    result.progress = progress(credited, result.plannedMinutes);
    result.moved = sessions.filter(s => s.moves.some(m => (m.from >= from && m.from <= to) || (m.to >= from && m.to <= to))).length;
    result.unmarkedDays = [...new Set(all.map(s => s.plan.date))].filter(date => all.filter(s => s.plan.date === date).every(s => !hasFact(s))).sort();
    return result;
}
export function dayStatus(state, date) {
    const sessions = Object.values(state.sessions).filter(s => s.plan.date === date), main = sessions.filter(s => s.plan.kind === 'main');
    if (main.length > 0) {
        if (main.every(s => s.fact.taskOutcome === 'skipped'))
            return 'skipped';
        if (main.every(s => s.fact.actualMinutes >= s.plan.plannedMinutes))
            return 'complete';
        if (sessions.some(hasFact))
            return 'partial';
        return 'none';
    }
    const historicalTime = Object.values(state.sessions).some(s => s.fact.timeEntries.some(e => e.date === date));
    if (historicalTime)
        return 'partial';
    const rest = Object.values(state.weeks).some(w => w.restDates.includes(date)) || new Date(`${date}T12:00:00`).getDay() === 0;
    if (rest)
        return 'rest';
    if (sessions.some(hasFact))
        return 'partial';
    return 'none';
}
function planKey(plan) { return JSON.stringify([plan.id, plan.date, plan.kind, plan.subject, plan.module, plan.topic, plan.objective, plan.task, plan.source, plan.sourceAccess, plan.plannedMinutes, plan.prompt, plan.promptTarget ?? '']); }
export function previewImport(state, plan) {
    const result = { added: [], updated: [], unchanged: [], conflicts: [] };
    for (const incoming of plan.sessions) {
        const existing = Object.hasOwn(state.sessions, incoming.id) ? state.sessions[incoming.id] : undefined;
        if (!existing)
            result.added.push(incoming);
        else if (planKey(existing.plan) === planKey(incoming))
            result.unchanged.push(incoming);
        else if (hasFact(existing) || existing.moves.length > 0)
            result.conflicts.push(incoming);
        else
            result.updated.push(incoming);
    }
    return result;
}
export function applyImport(state, plan, keepConflicts = false) {
    const preview = previewImport(state, plan);
    if (preview.conflicts.length && !keepConflicts)
        throw new Error('В плане есть занятия с сохранёнными результатами. Выберите сохранение существующих записей или отмените импорт.');
    const next = structuredClone(state);
    for (const item of preview.added)
        next.sessions[item.id] = makeSession(item);
    for (const item of preview.updated) {
        const existing = next.sessions[item.id];
        const moved = item.date !== existing.plan.date ? moveSession(existing, item.date) : existing;
        next.sessions[item.id] = { ...moved, plan: structuredClone(item) };
    }
    next.weeks[plan.weekStart] = { planId: plan.planId, restDates: [...plan.restDates], importedAt: new Date().toISOString() };
    return next;
}
