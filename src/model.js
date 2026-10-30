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
    return { version: 2, revision: 0, sessions: {}, deletedSessions: {}, weeks: {}, wizard: { step: 1, weekStart: nextMonday(today), informatik: { text: '', unavailable: false }, mathematik: { text: '', unavailable: false }, preferences: '', importDraft: '' } };
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
    if (!isActiveSession(session))
        throw new Error('Сначала явно восстановите отменённое занятие.');
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
export function isActiveSession(session) { return !session.cancelledAt; }
/** Administrative history is retained even when logged minutes were later corrected to zero. */
export function requiresHistoryPreservation(session) { return hasFact(session) || session.moves.length > 0; }
export function stats(state, from, to) {
    const sessions = Object.values(state.sessions), dated = sessions.filter(s => s.plan.date >= from && s.plan.date <= to), all = dated.filter(isActiveSession), main = all.filter(s => s.plan.kind === 'main');
    const cancelled = dated.filter(s => !isActiveSession(s));
    const result = { plannedMinutes: 0, actualMinutes: 0, progress: 0, completed: 0, unfinished: 0, skipped: 0, cancelled: cancelled.length, cancelledPlannedMinutes: cancelled.filter(s => s.plan.kind === 'main').reduce((n, s) => n + s.plan.plannedMinutes, 0), unmarkedDays: [], moved: 0, bySubject: { Informatik: 0, Mathematik: 0, Spanisch: 0 }, quizletMinutes: 0, simpleclubMinutes: 0 };
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
    const sessions = Object.values(state.sessions).filter(s => s.plan.date === date && isActiveSession(s)), main = sessions.filter(s => s.plan.kind === 'main');
    const historicalTime = Object.values(state.sessions).some(s => s.fact.timeEntries.some(e => e.date === date));
    if (main.length > 0) {
        if (main.every(s => s.fact.taskOutcome === 'skipped'))
            return historicalTime ? 'partial' : 'skipped';
        if (main.every(s => s.fact.actualMinutes >= s.plan.plannedMinutes))
            return 'complete';
        if (sessions.some(hasFact) || historicalTime)
            return 'partial';
        return 'none';
    }
    if (historicalTime)
        return 'partial';
    const rest = Object.values(state.weeks).some(w => !w.removedAt && w.restDates.includes(date)) || new Date(`${date}T12:00:00`).getDay() === 0;
    if (rest)
        return 'rest';
    if (sessions.some(hasFact))
        return 'partial';
    return 'none';
}
function planKey(plan) { return JSON.stringify([plan.id, plan.date, plan.kind, plan.subject, plan.module, plan.topic, plan.objective, plan.task, plan.source, plan.sourceAccess, plan.plannedMinutes, plan.prompt, plan.promptTarget ?? '']); }
export function previewImport(state, plan) {
    const result = { added: [], updated: [], unchanged: [], conflicts: [], suppressed: [] };
    for (const incoming of plan.sessions) {
        const existing = Object.hasOwn(state.sessions, incoming.id) ? state.sessions[incoming.id] : undefined;
        if (Object.hasOwn(state.deletedSessions, incoming.id) || (existing && !isActiveSession(existing)))
            result.suppressed.push(incoming);
        else if (!existing)
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
        next.sessions[item.id] = { ...makeSession(item), importOrigin: { weekStart: plan.weekStart, planId: plan.planId } };
    for (const item of preview.updated) {
        const existing = next.sessions[item.id];
        const moved = item.date !== existing.plan.date ? moveSession(existing, item.date) : existing;
        next.sessions[item.id] = { ...moved, plan: structuredClone(item) };
    }
    // Only explicitly marked migrated records may gain missing provenance. A matching new manual ID is not ownership evidence.
    for (const item of [...preview.unchanged, ...preview.updated, ...preview.conflicts]) {
        const existing = next.sessions[item.id];
        const safeMatch = planKey({ ...existing.plan, date: existing.moves[0]?.from ?? existing.plan.date }) === planKey(item);
        if (existing.legacyProvenanceUnknown && !existing.importOrigin && Object.hasOwn(state.weeks, plan.weekStart) && (!preview.conflicts.includes(item) || safeMatch)) {
            existing.importOrigin = { weekStart: plan.weekStart, planId: plan.planId };
            delete existing.legacyProvenanceUnknown;
        }
    }
    const prior = next.weeks[plan.weekStart];
    const sessionIds = [...new Set([...(prior?.sessionIds ?? []), ...Object.values(next.sessions).filter(s => s.importOrigin?.weekStart === plan.weekStart).map(s => s.plan.id), ...Object.values(next.deletedSessions).filter(s => s.session.importOrigin?.weekStart === plan.weekStart).map(s => s.session.plan.id)])];
    const stillRemoved = prior?.removedAt && !sessionIds.some(id => next.sessions[id] && isActiveSession(next.sessions[id]));
    const provenanceKnown = plan.sessions.every(p => (next.sessions[p.id] ?? next.deletedSessions[p.id]?.session)?.importOrigin?.weekStart === plan.weekStart);
    next.weeks[plan.weekStart] = { planId: plan.planId, restDates: [...plan.restDates], importedAt: new Date().toISOString(), sessionIds, provenanceKnown, ...(stillRemoved ? { removedAt: prior.removedAt } : {}) };
    return next;
}
export function removeSessionFromPlan(state, id, reason = 'session') {
    if (!Object.hasOwn(state.sessions, id))
        throw new Error('Занятие не найдено.');
    const next = structuredClone(state), session = next.sessions[id];
    if (!isActiveSession(session))
        return next;
    const now = new Date().toISOString();
    if (requiresHistoryPreservation(session))
        session.cancelledAt = now;
    else {
        next.deletedSessions[id] = { session, removedAt: now, reason };
        delete next.sessions[id];
    }
    return next;
}
/** UI must ask for explicit confirmation before calling this function. */
export function restoreRemovedSession(state, id) {
    const next = structuredClone(state);
    if (Object.hasOwn(next.deletedSessions, id)) {
        if (Object.hasOwn(next.sessions, id))
            throw new Error('Идентификатор уже используется. Восстановление остановлено.');
        next.sessions[id] = next.deletedSessions[id].session;
        delete next.deletedSessions[id];
    }
    else if (!Object.hasOwn(next.sessions, id) || isActiveSession(next.sessions[id]))
        throw new Error('Удалённое или отменённое занятие не найдено.');
    delete next.sessions[id].cancelledAt;
    const start = next.sessions[id].importOrigin?.weekStart;
    if (start && next.weeks[start])
        delete next.weeks[start].removedAt;
    return next;
}
export function previewRemoveWeek(state, weekStart) {
    if (!isDate(weekStart) || monday(weekStart) !== weekStart || !Object.hasOwn(state.weeks, weekStart))
        throw new Error('Импортированный план этой недели не найден.');
    const week = state.weeks[weekStart], end = addDays(weekStart, 6);
    const active = Object.values(state.sessions).filter(isActiveSession);
    const owned = active.filter(s => s.importOrigin?.weekStart === weekStart);
    const unassigned = active.filter(s => !s.importOrigin && (s.plan.date >= weekStart && s.plan.date <= end || s.moves[0]?.from >= weekStart && s.moves[0]?.from <= end));
    return { removed: owned.filter(s => !requiresHistoryPreservation(s)), cancelled: owned.filter(requiresHistoryPreservation), unassigned, ownershipUnknown: !week.provenanceKnown };
}
export function removeWeekPlan(state, weekStart) {
    const preview = previewRemoveWeek(state, weekStart);
    let next = structuredClone(state);
    for (const session of [...preview.removed, ...preview.cancelled])
        next = removeSessionFromPlan(next, session.plan.id, 'week');
    next.weeks[weekStart].removedAt = new Date().toISOString();
    return next;
}
