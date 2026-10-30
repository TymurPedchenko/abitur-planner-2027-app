import { OUTCOMES } from "./types.js";
import { loadProjectConfig, saveProjectConfig, PROJECT_CONFIG_KEY } from "./project-config.js";
import { localDate, addDays, monday, emptyState, makeSession, progress, addTime, removeTime, setOutcome, moveSession, stats, dayStatus, previewImport, applyImport } from "./model.js";
import { loadState, saveState, replaceState, serializeBackup, STORAGE_KEY } from "./storage.js";
import { parseWeekPlan, parseBackup } from "./validation.js";
import { handoffPrompt, buildBundle, coordinatorPrompt } from "./planning.js";
import { buildCoordinatorRequest, planLoadReview } from "./planning.js";
import { isActiveSession, hasFact, removeSessionFromPlan, restoreRemovedSession, previewRemoveWeek, removeWeekPlan } from "./model.js";
import { buildSessionPrompt, recommendChatGPTMode, copyPrompt, SHORTCUT_URL } from "./chatgpt.js";
import { loadChatGPTLaunchConfig, saveChatGPTLaunchConfig, CHATGPT_LAUNCH_KEY } from "./project-config.js";
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const loaded = loadState();
let state = loaded.state;
const loadedProjects = loadProjectConfig();
let projectConfig = loadedProjects.config;
let projectConfigError = loadedProjects.error || '';
let storageError = loaded.error || '';
let recoveryRaw = loaded.raw || '';
let tab = 'today';
let today = localDate();
let selectedDay = today;
let selectedWeek = monday(today);
let selectedMonth = today.slice(0, 7) + '-01';
let monthStats = false;
let preview = null;
let backupPreview = null;
let offlineReady = false;
let dialogId = '';
let pendingWeek = '';
let recordDate = '';
let pendingRemoval = '';
let pendingRestore = '';
let pendingRemovalWeek = '';
let launchConfig = loadChatGPTLaunchConfig();
function clearBackupCandidate() { backupPreview = null; const pane = modal.querySelector('#backup-preview'); if (pane)
    pane.innerHTML = ''; }
function clearPlanPreview() { preview = null; document.querySelector('#plan-preview')?.remove(); }
const timeLocks = new Map();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
    today: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="m8 12 3 3 5-6"/>',
    week: '<rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v4m10-4v4M3 11h18M8 15h1m6 0h1m-8 3h1"/>',
    history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v6l4 2"/>',
    planning: '<path d="m15 3 6 6M4 20l5-1L21 7l-4-4L5 15l-1 5Z"/>',
    settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z"/><circle cx="12" cy="12" r="3"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>', plus: '<path d="M12 5v14M5 12h14"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="3"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', book: '<path d="M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Zm0 0v15"/>', check: '<path d="m5 12 5 5L20 6"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>', external: '<path d="M14 3h7v7m0-7L11 13m-1-8H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const fmt = (date, opts = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('ru-RU', opts).format(new Date(date + 'T12:00:00'));
const label = (date) => fmt(date, { weekday: 'long' });
const duration = (minutes) => minutes >= 60 ? `${Math.floor(minutes / 60)} ч${minutes % 60 ? ' ' + minutes % 60 + ' мин' : ''}` : `${minutes} мин`;
const items = (date) => Object.values(state.sessions).filter(s => s.plan.date === date && isActiveSession(s)).sort((a, b) => a.plan.kind === 'main' && b.plan.kind !== 'main' ? -1 : a.plan.kind !== 'main' && b.plan.kind === 'main' ? 1 : 0);
const btn = (text, action, cls = 'secondary', attrs = '') => `<button class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const subjectClass = (s) => s === 'Informatik' ? 'inf' : s === 'Mathematik' ? 'mat' : 'spa';
function toast(message) { const t = document.querySelector('#toast'); t.textContent = message; t.classList.add('show'); window.setTimeout(() => t.classList.remove('show'), 3500); }
function commit(fn, redraw = true) {
    if (storageError) {
        toast('Сначала восстановите локальные данные в настройках.');
        return false;
    }
    try {
        const next = fn(structuredClone(state));
        saveState(next);
        state = next;
        if (redraw)
            render();
        return true;
    }
    catch (e) {
        toast(String(e.message));
        return false;
    }
}
function updateSession(id, fn) { return commit(s => { s.sessions[id] = fn(s.sessions[id]); return s; }); }
function download(name, content) { const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
async function copy(text) { const result = await copyPrompt(text); if (result.ok) {
    toast('Текст скопирован');
    return true;
} openDialog('Скопировать текст', `<p>Автоматическое копирование недоступно. Выдели весь текст и выбери «Копировать». Текст не сокращён.</p><textarea id="prepared-prompt" class="copy-fallback" readonly>${esc(text)}</textarea>${btn('Выделить весь текст', 'select-prompt')}`); selectPrompt(); return false; }
function selectPrompt() { const area = modal.querySelector('#prepared-prompt'); area?.focus(); area?.select(); }
function modeHint(s) { const r = recommendChatGPTMode(s.plan); return `<p class="mode-hint">Рекомендуемый режим ChatGPT: <strong>${r.mode}</strong><small>${esc(r.reason)} ${esc(r.notice)}</small></p>`; }
function launchLinks(subject) { return `<div class="button-row">${launchConfig.config.shortcutEnabled ? `<a id="shortcut-launch" class="button primary" href="${SHORTCUT_URL}">Открыть приложение через команду</a>` : ''}<a class="button secondary" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Открыть ChatGPT в браузере</a>${subject && subject !== 'Spanisch' ? projectShortcut(subject) : ''}</div><p class="quiet-note">Можно открыть ChatGPT вручную. Вставь промпт, выбери подходящий режим и отправь его самостоятельно. Переход в проект — отдельное действие; iOS может открыть его в Safari.</p>`; }
async function startChatGPT(id) { const session = state.sessions[id]; if (!session)
    return; const text = buildSessionPrompt(session), result = await copyPrompt(text); openDialog('Начать в ChatGPT', `${modeHint(session)}<p class="notice">${result.ok ? 'Промпт скопирован. Открой ChatGPT и вставь его в нужный разговор.' : 'Автоматическое копирование не удалось. Текст сохранён ниже целиком — выдели и скопируй его вручную.'}</p><label class="field">Полный промпт<textarea id="prepared-prompt" class="copy-fallback" readonly>${esc(text)}</textarea></label>${btn('Выделить весь текст', 'select-prompt')}${result.ok ? launchLinks(session.plan.subject) : `<label class="check-field"><input id="manual-copy-confirm" type="checkbox">Я скопировал текст вручную</label>${btn('Перейти к открытию ChatGPT', 'manual-copy-ready', 'primary', `data-id="${esc(id)}"`)}`}<p class="quiet-note">Никакие сообщения не отправлены; файл не прикрепляется автоматически.</p>`); if (!result.ok)
    selectPrompt(); }
function openDialog(title, body, id = '') { dialogId = id; modal.innerHTML = `<div class="dialog-header"><h2>${esc(title)}</h2>${btn(icon('close'), 'close', 'icon-button', 'aria-label="Закрыть"')}</div><div class="dialog-body">${body}</div>`; if (!modal.open)
    modal.showModal(); }
function closeDialog() { modal.close(); dialogId = ''; }
function summary(from, to) { const s = stats(state, from, to); return `<section class="summary"><div class="summary-top"><div><span class="eyebrow">ОСНОВНЫЕ ЗАНЯТИЯ</span><div class="big-number">${s.actualMinutes}<span> / ${s.plannedMinutes} мин</span></div></div><span class="percent">${s.progress}%</span></div><div class="progress-track"><span style="width:${s.progress}%"></span></div><div class="summary-bottom"><span>${s.completed} завершено · ${s.unfinished} осталось${s.cancelled ? ` · ${s.cancelled} отменено` : ""}</span><span>Выполнение времени</span></div><p class="summary-explanation">До 100% за каждый активный блок. Фактическое время включает сохранённую работу отменённых занятий; она не закрывает активный план.</p></section>`; }
function card(s, compact = false) { const p = s.plan, f = s.fact, pr = progress(f.actualMinutes, p.plannedMinutes); return `<article class="session-card ${compact ? 'compact' : ''}"><div class="card-meta"><span class="subject ${subjectClass(p.subject)}"><i></i>${esc(p.kind === 'main' ? p.subject : p.kind === 'quizlet' ? 'Quizlet' : 'simpleclub')}</span><span>${p.plannedMinutes} мин${p.kind !== 'main' ? ' · дополнительно' : ''}</span></div><div class="module">${esc(p.module || p.subject)}</div><h3>${esc(p.topic)}</h3>${!compact ? `<p class="objective">${esc(p.objective)}</p><p class="task-text">${esc(p.task)}</p>` : ''}<div class="time-row"><span><strong>${f.actualMinutes}</strong> / ${p.plannedMinutes} мин</span><span>${pr}% времени</span></div><div class="progress-track slim"><span style="width:${pr}%"></span></div><div class="card-bottom"><span class="outcome ${f.taskOutcome}">${esc(OUTCOMES[f.taskOutcome])}</span>${btn('Записать время', 'edit', 'text-button', `data-id="${esc(p.id)}"`)}</div>${modeHint(s)}<div class="card-actions">${btn('Начать в ChatGPT', 'start-chatgpt', 'primary', `data-id="${esc(p.id)}"`)}${btn('•••', 'session-menu', 'icon-button', `data-id="${esc(p.id)}" aria-label="Управление занятием ${esc(p.subject)}"`)}</div></article>`; }
function sessionMenu(id) { const s = state.sessions[id]; if (!s)
    return; openDialog('Управление занятием', `<p>${esc(s.plan.subject)} · ${fmt(s.plan.date)}</p><h3>${esc(s.plan.topic)}</h3><div class="action-menu">${btn('Открыть занятие', 'edit', 'secondary', `data-id="${esc(id)}"`)}${btn('Копировать промпт', 'copy-session', 'secondary', `data-id="${esc(id)}"`)}${s.plan.subject !== 'Spanisch' ? projectShortcut(s.plan.subject) : ''}${isActiveSession(s) ? btn((hasFact(s) || s.moves.length > 0) ? 'Отменить занятие с сохранением истории' : 'Удалить занятие', 'remove-session', 'danger-button', `data-id="${esc(id)}"`) : btn('Восстановить в плане', 'restore-removed', 'secondary', `data-id="${esc(id)}"`)}</div>`); }
function removeSessionDialog(id) { const s = state.sessions[id]; if (!s)
    return; pendingRemoval = id; openDialog((hasFact(s) || s.moves.length > 0) ? 'Отменить занятие?' : 'Удалить занятие?', `<p><strong>${esc(s.plan.subject)}</strong> · ${fmt(s.plan.date)}</p><h3>${esc(s.plan.topic)}</h3><p>${(hasFact(s) || s.moves.length > 0) ? `Сохраним ${s.fact.actualMinutes} фактических минут, результат и заметки в истории. Занятие перестанет входить в активный план; отмена не считается пропуском.` : 'Ошибочная запись будет убрана из плана. Другие занятия не изменятся. Повторный импорт не восстановит её без отдельного действия.'}</p><label class="check-field"><input id="remove-confirm" type="checkbox">Подтверждаю ${(hasFact(s) || s.moves.length > 0) ? 'отмену с сохранением истории' : 'удаление этого занятия'}</label><div class="button-row">${btn('Подтвердить', 'confirm-remove-session', 'danger-button')}${btn('Оставить занятие', 'close')}</div>`); }
function restoreSessionDialog(id) { const s = state.sessions[id] || state.deletedSessions[id]?.session; if (!s)
    return; pendingRestore = id; openDialog('Восстановить занятие в плане?', `<p>${esc(s.plan.subject)} · ${fmt(s.plan.date)}</p><h3>${esc(s.plan.topic)}</h3><p>Вернётся именно сохранённая запись с прежним идентификатором. Факты и минуты не будут сброшены. После восстановления последующие импорты снова смогут обновлять пустое занятие.</p><label class="check-field"><input id="restore-session-confirm" type="checkbox">Подтверждаю восстановление</label>${btn('Восстановить занятие', 'confirm-restore-session', 'primary')}`); }
function removalWeekDialog(week) { const preview = previewRemoveWeek(state, week); pendingRemovalWeek = week; const list = (a) => a.map(s => `<li>${fmt(s.plan.date)} · ${esc(s.plan.subject)} — ${esc(s.plan.topic)} (${s.fact.actualMinutes} мин)</li>`).join(''); openDialog('Удалить план недели?', `<p>Исходная неделя импорта: ${fmt(week)} — ${fmt(addDays(week, 6))}. Перенесённые занятия этого плана также показаны здесь.</p><h3>Удалить без результатов: ${preview.removed.length}</h3><ul class="review-list">${list(preview.removed) || '<li>Нет</li>'}</ul><h3>Сохранить историю и отменить план: ${preview.cancelled.length}</h3><ul class="review-list">${list(preview.cancelled) || '<li>Нет</li>'}</ul>${preview.ownershipUnknown ? `<div class="notice warning">Для ${preview.unassigned.length} записей старой версии происхождение не подтверждено. Они останутся без изменений. Для точного удаления можно повторно проверить исходный JSON плана или управлять занятиями отдельно.</div>` : ''}<p>Фактические минуты сохранятся. Занятия других импортов и ручные записи не удаляются. Повторный импорт не восстановит удалённые записи.</p><label class="check-field"><input id="remove-week-confirm" type="checkbox">Подтверждаю показанные изменения</label><div class="button-row">${btn('Удалить показанный план', 'confirm-remove-week', 'danger-button', preview.removed.length + preview.cancelled.length === 0 ? 'disabled' : '')}${btn('Оставить план', 'close')}</div>`); }
function removedHistory(from, to) { const cancelled = Object.values(state.sessions).filter(s => !isActiveSession(s) && (s.plan.date >= from && s.plan.date <= to || s.fact.timeEntries.some(e => e.date >= from && e.date <= to))); const deleted = Object.entries(state.deletedSessions).filter(([, x]) => x.session.plan.date >= from && x.session.plan.date <= to); return cancelled.length + deleted.length ? `<section class="settings-section"><h3>Отменённые и удалённые занятия</h3><p class="quiet-note">Отмена плана не считается пропуском. Фактическая работа входит в историю.</p>${cancelled.map(s => `<div class="archived-session"><span class="cancelled-label">План отменён</span><strong>${esc(s.plan.subject)} · ${esc(s.plan.topic)}</strong><p>${fmt(s.plan.date)} · ${s.fact.actualMinutes} мин фактически · ${esc(OUTCOMES[s.fact.taskOutcome])}</p><div class="button-row">${btn('Открыть историю', 'edit', 'secondary', `data-id="${esc(s.plan.id)}"`)}${btn('Восстановить в плане', 'restore-removed', 'text-button', `data-id="${esc(s.plan.id)}"`)}</div></div>`).join('')}${deleted.length ? `<details><summary>Удалённые без результатов · ${deleted.length}</summary>${deleted.map(([id, x]) => `<div class="archived-session"><strong>${esc(x.session.plan.subject)} · ${esc(x.session.plan.topic)}</strong><p>${fmt(x.session.plan.date)} · не входит в статистику</p>${btn('Восстановить', 'restore-removed', 'secondary', `data-id="${esc(id)}"`)}</div>`).join('')}</details>` : ''}</section>` : ''; }
function dayView() { const historical = Object.values(state.sessions).filter(s => (s.plan.date !== selectedDay || !isActiveSession(s)) && s.fact.timeEntries.some(e => e.date === selectedDay)); const dayItems = items(selectedDay), main = dayItems.filter(s => s.plan.kind === 'main'), extra = dayItems.filter(s => s.plan.kind !== 'main'); const isToday = selectedDay === today; return `<div class="page-heading"><div><p class="eyebrow">${esc(label(selectedDay))} · ${fmt(selectedDay)}</p><h1>${isToday ? 'Сегодня' : fmt(selectedDay)}</h1><p class="subtitle">${main.length ? 'Небольшие шаги. Заметное движение вперёд.' : 'Место для твоего следующего шага.'}</p></div>${!isToday ? btn('К сегодняшнему дню', 'go-today') : ''}</div>${summary(selectedDay, selectedDay)}<div class="section-heading"><h2>Твой план <span>${main.length ? String(main.length).padStart(2, '0') : ''}</span></h2>${btn(icon('plus') + ' Добавить', 'add-main', 'text-button')}</div>${main.length ? `<div class="cards-grid">${main.map(s => card(s)).join('')}</div>` : `<section class="empty-state"><div class="empty-icon">${icon(dayStatus(state, selectedDay) === 'rest' ? 'check' : 'book')}</div><h2>${dayStatus(state, selectedDay) === 'rest' ? 'Можно выдохнуть' : 'План ещё не добавлен'}</h2><p>${dayStatus(state, selectedDay) === 'rest' ? 'Это день отдыха. Можно подвести итоги и спокойно подготовить следующую неделю.' : 'Собери неделю с ChatGPT или добавь первое занятие самостоятельно.'}</p>${btn('Перейти к планированию ' + icon('arrow'), 'nav-planning', 'primary')}</section>`}${historical.length ? `<div class="section-heading"><h2>Занимался в этот день</h2></div><div class="historical-list">${historical.map(s => `<button class="historical-session" data-action="edit" data-id="${esc(s.plan.id)}" data-record-date="${selectedDay}"><span class="subject ${subjectClass(s.plan.subject)}"><i></i>${s.plan.subject}</span><strong>${esc(s.plan.topic)}</strong><small>${s.fact.timeEntries.filter(e => e.date === selectedDay).reduce((n, e) => n + e.minutes, 0)} мин в этот день · ${isActiveSession(s) ? 'перенесено на ' + fmt(s.plan.date) : 'план отменён, история сохранена'}</small></button>`).join('')}</div>` : ''}<div class="section-heading"><h2>Немного дополнительно</h2><span class="muted">Не заменяет основные блоки</span></div><div class="extra-grid">${extra.map(s => card(s, true)).join('')}${!extra.some(s => s.plan.kind === 'quizlet') ? `<button class="extra-add" data-action="add-extra" data-kind="quizlet"><span class="activity-icon">Aa</span><span><strong>Quizlet</strong><small>Лексика · 15 минут</small></span>${icon('plus')}</button>` : ''}${!extra.some(s => s.plan.kind === 'simpleclub') ? `<button class="extra-add" data-action="add-extra" data-kind="simpleclub"><span class="activity-icon">▷</span><span><strong>simpleclub</strong><small>Короткое объяснение · 30 минут</small></span>${icon('plus')}</button>` : ''}</div><p class="quiet-note">Время показывает участие в плане. Освоение темы обсуждается на занятии.</p>`; }
function weekView() { const end = addDays(selectedWeek, 6), s = stats(state, selectedWeek, end); return `<div class="page-heading"><div><p class="eyebrow">РИТМ, КОТОРЫЙ ПОДХОДИТ ТЕБЕ</p><h1>Неделя</h1><p class="subtitle">${fmt(selectedWeek)} — ${fmt(end, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div><div class="period-buttons">${btn('←', 'week-prev', 'icon-button', 'aria-label="Предыдущая неделя"')}${btn('Текущая', 'week-current')}${btn('→', 'week-next', 'icon-button', 'aria-label="Следующая неделя"')}</div></div>${summary(selectedWeek, end)}${state.weeks[selectedWeek] ? `<div class="week-tools">${btn("Удалить план недели", "remove-week", "secondary", `data-week="${selectedWeek}"`)}</div>` : ""}<div class="week-list">${Array.from({ length: 7 }, (_, i) => { const d = addDays(selectedWeek, i), list = items(d); return `<section class="week-day ${d === today ? 'is-today' : ''}"><button class="day-heading" data-action="open-day" data-date="${d}"><span class="day-number">${fmt(d, { day: 'numeric' })}</span><span><strong>${esc(label(d))}</strong><small>${d === today ? 'Сегодня' : fmt(d, { month: 'long' })}</small></span>${icon('arrow')}</button><div class="day-sessions">${list.length ? list.map(s => `<button class="week-session" data-action="edit" data-id="${esc(s.plan.id)}"><span class="subject ${subjectClass(s.plan.subject)}"><i></i>${esc(s.plan.kind === 'main' ? s.plan.subject : s.plan.kind === 'quizlet' ? 'Quizlet' : 'simpleclub')}</span><strong>${esc(s.plan.topic)}</strong><span class="week-session-footer"><span>${s.fact.actualMinutes} / ${s.plan.plannedMinutes} мин</span><span class="outcome ${s.fact.taskOutcome}">${esc(OUTCOMES[s.fact.taskOutcome])}</span></span></button>`).join('') : `<div class="rest-label">${dayStatus(state, d) === 'rest' ? 'Отдых · время для себя' : 'Нет занятий'}</div>`}</div></section>`; }).join('')}</div><p class="quiet-note">${s.moved} переносов за неделю. Пропуски не превращаются в автоматический долг.</p>${removedHistory(selectedWeek, end)}`; }
function statDetails(from, to) { const s = stats(state, from, to); return `<div class="stat-grid"><div><strong>${duration(s.plannedMinutes)}</strong><span>Основной план</span></div><div><strong>${duration(s.actualMinutes)}</strong><span>Фактическое время</span></div><div><strong>${s.completed}</strong><span>Завершено</span></div><div><strong>${s.unfinished}</strong><span>Незавершено</span></div><div><strong>${s.skipped}</strong><span>Подтверждённые пропуски активного плана</span></div><div><strong>${s.cancelled}</strong><span>Отменено с сохранением истории</span></div><div><strong>${s.progress}%</strong><span>Выполнение времени</span></div></div><div class="subject-stats">${['Informatik', 'Mathematik', 'Spanisch'].map(subject => `<div><span class="subject ${subjectClass(subject)}"><i></i>${subject}</span><strong>${duration(s.bySubject[subject])}</strong></div>`).join('')}<div><span>Quizlet <small>дополнительно</small></span><strong>${duration(s.quizletMinutes)}</strong></div><div><span>simpleclub <small>дополнительно</small></span><strong>${duration(s.simpleclubMinutes)}</strong></div></div>`; }
function historyView() { const first = selectedMonth, offset = (new Date(first + 'T12:00:00').getDay() + 6) % 7, next = new Date(first + 'T12:00:00'); next.setMonth(next.getMonth() + 1); const last = addDays(localDate(next), -1); const days = Number(last.slice(8)); const start = monthStats ? first : selectedWeek, end = monthStats ? last : addDays(selectedWeek, 6); const names = { complete: 'План выполнен', partial: 'Частично', skipped: 'Пропущен', rest: 'Отдых', none: 'Нет данных' }; return `<div class="page-heading"><div><p class="eyebrow">КАЖДОЕ ЗАНЯТИЕ ИМЕЕТ ЗНАЧЕНИЕ</p><h1>История</h1><p class="subtitle">Честная картина без оценок и догадок.</p></div></div><div class="history-layout"><section class="calendar-panel"><div class="section-heading"><h2 class="capitalize">${fmt(first, { month: 'long', year: 'numeric' })}</h2><div class="period-buttons">${btn('←', 'month-prev', 'icon-button', 'aria-label="Предыдущий месяц"')}${btn('→', 'month-next', 'icon-button', 'aria-label="Следующий месяц"')}</div></div><div class="calendar-grid weekdays">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-grid">${'<span></span>'.repeat(offset)}${Array.from({ length: days }, (_, i) => { const d = addDays(first, i), status = dayStatus(state, d); return `<button class="calendar-day ${status} ${d === today ? 'current' : ''}" data-action="open-day" data-date="${d}" aria-label="${fmt(d)}: ${names[status]}"><span>${i + 1}</span><i></i></button>`; }).join('')}</div><div class="legend">${Object.entries(names).map(([key, name]) => `<span><i class="${key}"></i>${name}</span>`).join('')}</div><p class="quiet-note">Нет отметки — нет данных, а не пропуск. Нажми на день, чтобы исправить запись.</p></section><section class="statistics-panel"><div class="section-heading"><h2>В цифрах</h2><div class="segmented">${btn('Неделя', 'stats-week', !monthStats ? 'active' : '')}${btn('Месяц', 'stats-month', monthStats ? 'active' : '')}</div></div><div class="stats-period">${!monthStats ? btn('←', 'week-prev', 'icon-button', 'aria-label="Предыдущая неделя статистики"') : ''}<span>${fmt(start)} — ${fmt(end)}</span>${!monthStats ? btn('→', 'week-next', 'icon-button', 'aria-label="Следующая неделя статистики"') : ''}</div>${statDetails(start, end)}</section></div>${removedHistory(start, end)}`; }
function projectShortcut(subject) { const url = projectConfig.projects[subject]; return url ? `<a class="button secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть проект ${icon('external')}</a>` : btn('Настроить проект ' + subject, 'settings', 'secondary'); }
function handoffStep(subject) { const key = subject === 'Informatik' ? 'informatik' : 'mathematik', report = state.wizard[key]; return `<span class="subject ${subjectClass(subject)}"><i></i>${subject} LK</span><h2>Получить учебный отчёт ${subject}</h2><p>Открой предметный проект, отправь промпт и вставь полученный WEEKLY_HANDOFF сюда. Только подтверждённые задания, ошибки и следующие шаги.</p><div class="button-row">${btn(icon('copy') + ' Копировать промпт', 'copy-handoff', 'primary', `data-subject="${subject}"`)}${projectShortcut(subject)}</div><label class="field">Отчёт ${subject}<textarea id="handoff-${key}" data-wizard="${key}" maxlength="100000" placeholder="Вставь ответ из проекта…" ${report.unavailable ? 'disabled' : ''}>${esc(report.text)}</textarea></label><label class="check-field"><input type="checkbox" data-unavailable="${key}" ${report.unavailable ? 'checked' : ''}>Нет подтверждённых данных по ${subject}</label><p class="quiet-note">Копирование промпта не завершает шаг. Нужен отчёт или явная отметка об отсутствии данных.</p>`; }
function previewHtml(plan) { const p = previewImport(state, plan), load = planLoadReview(plan); return `<div class="import-summary"><strong>${fmt(plan.weekStart)} — ${fmt(addDays(plan.weekStart, 6))}</strong><span>${p.added.length} новых · ${p.updated.length} обновлений · ${p.unchanged.length} без изменений</span></div>${load.warnings.length ? `<div class="notice warning"><strong>Нагрузка: ${load.mainCount} основных блоков</strong><ul>${load.warnings.map(x => `<li>${esc(x)}</li>`).join("")}</ul>${plan.rationale ? `<p>Обоснование: ${esc(plan.rationale)}</p>` : ""}</div>` : ""}${p.suppressed.length ? `<div class="notice">${p.suppressed.length} ранее удалённых или отменённых занятий не будут восстановлены. Для восстановления используй историю и отдельное подтверждение.</div>` : ""}${p.conflicts.length ? `<div class="notice warning"><strong>${p.conflicts.length} конфликтов с сохранёнными записями</strong><p>Существующие результаты и занятия будут сохранены. Применить можно только остальные изменения.</p><ul>${p.conflicts.map(s => `<li>${esc(s.subject)} — ${esc(s.topic)} (${esc(s.id)})</li>`).join('')}</ul></div>` : ''}<div class="preview-days">${Array.from({ length: 7 }, (_, i) => { const date = addDays(plan.weekStart, i); return `<div><strong>${esc(label(date))}, ${fmt(date)}</strong>${plan.sessions.filter(s => s.date === date).map(s => `<p>${esc(s.subject)}${s.kind !== 'main' ? ' · ' + esc(s.kind) : ''} — ${esc(s.topic)} <span>${s.plannedMinutes} мин</span></p>`).join('') || '<p class="muted">' + (plan.restDates.includes(date) ? 'Отдых' : 'Нет занятий') + '</p>'}</div>`; }).join('')}</div><p class="quiet-note">Занятия, которых нет в этом файле, не удаляются. Сохранённые результаты остаются на месте.</p><div class="button-row">${btn(p.conflicts.length ? 'Сохранить конфликты и применить остальное' : 'Подтвердить импорт', 'apply-import', 'primary')}${btn('Отменить просмотр', 'cancel-import')}</div>`; }
function planningView() {
    const w = state.wizard, previous = addDays(w.weekStart, -7), end = addDays(w.weekStart, -1), s = stats(state, previous, end);
    let content = '';
    if (w.step === 1)
        content = `<h2>Сначала — итоги</h2><p>Неделя ${fmt(previous)} — ${fmt(end)}. Всё уже собрано из твоих записей.</p>${statDetails(previous, end)}<div class="notice">Переносов: ${s.moved}. Дней с планом без отметок: ${s.unmarkedDays.length}.${s.unmarkedDays.length ? `<div class="date-links">${s.unmarkedDays.map(d => btn(fmt(d), 'open-day', 'text-button', `data-date="${d}"`)).join('')}</div>` : ''}</div><div class="review-days">${Array.from({ length: 7 }, (_, i) => { const d = addDays(previous, i); return btn(`${fmt(d)} · ${items(d).length} занятий`, 'open-day', 'secondary', `data-date="${d}"`); }).join('')}</div><p class="quiet-note">Открой нужный день, чтобы исправить время или результат. Вернувшись сюда, ты продолжишь с этого шага.</p>`;
    if (w.step === 2)
        content = handoffStep('Informatik');
    if (w.step === 3)
        content = handoffStep('Mathematik');
    if (w.step === 4)
        content = `<h2>Собери следующую неделю</h2><p>Рекомендуемый режим ChatGPT: <strong>High</strong>. Выбери его вручную, если он доступен в твоей версии.</p><label class="field">Пожелания на неделю<textarea data-preferences maxlength="10000" placeholder="Например: в четверг один блок; остальные дни доступны…">${esc(w.preferences)}</textarea></label><div class="policy-grid"><div><strong>60 мин</strong><span>основной блок</span></div><div><strong>5 / 5 / 2</strong><span>Inf · Mathe · Spanisch</span></div><div><strong>Воскресенье</strong><span>отдых и планирование</span></div></div><p>Обычно 12 основных блоков; 10 — при обоснованном снижении. Менее 10 требует объяснения. Плавное начало меняет сложность, а не автоматически сокращает неделю вдвое.</p><ol class="instructions"><li>Скопируй единый запрос: инструкции, схема и полные реальные данные.</li><li>Открой обычный разговор ChatGPT, вставь текст и отправь самостоятельно.</li><li>Если текст слишком большой, скачай JSON, прикрепи его вручную и скопируй отдельный промпт координатора.</li><li>Верни полученный week_plan.json на следующем шаге.</li></ol><div class="button-row">${btn(icon('copy') + ' Скопировать запрос со всеми данными', 'copy-coordinator-data', 'primary')}${btn(icon('download') + ' Скачать JSON', 'export-bundle')}${btn('Только инструкции для файла', 'copy-coordinator')}<a class="button secondary" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Открыть ChatGPT ${icon('external')}</a></div><p class="quiet-note">В запрос включаются сохранённые отчёты и учебные записи. Передача происходит только после твоего действия; автоматического вложения и отправки нет. Личные ссылки проектов не включаются.</p>`;
    if (w.step === 5)
        content = `<h2>Новая неделя — на просмотр</h2><p>Вставь JSON из ответа координатора или выбери файл. План появится в календаре только после твоего подтверждения.</p><label class="field">Недельный план JSON<textarea data-import-draft spellcheck="false" maxlength="2097152" placeholder='{"schemaVersion": 1, "planId": "…", …}'>${esc(w.importDraft)}</textarea></label><div class="button-row">${btn('Проверить и посмотреть', 'check-import', 'primary')}<label class="button secondary file-label">Выбрать JSON-файл<input type="file" accept=".json,application/json" id="plan-file"></label></div><div id="import-error" class="inline-error" role="alert"></div>${preview ? `<div id="plan-preview">${previewHtml(preview)}</div>` : ''}`;
    const names = ['Итоги', 'Informatik', 'Mathematik', 'ChatGPT', 'Новый план'];
    return `<div class="page-heading"><div><p class="eyebrow">ВОСКРЕСНЫЙ РИТУАЛ</p><h1>Планирование</h1><p class="subtitle">Пять простых шагов — и неделя готова.</p></div></div><section class="wizard"><div class="wizard-top"><span>Шаг ${w.step} из 5</span><span>Сохраняется на устройстве</span></div><div class="wizard-steps">${names.map((name, i) => `<div class="${i + 1 === w.step ? 'current' : i + 1 < w.step ? 'done' : ''}"><span>${i + 1 < w.step ? '✓' : i + 1}</span><small>${name}</small></div>`).join('')}</div><label class="field week-start">План на неделю с понедельника<input type="date" id="target-week" value="${w.weekStart}"></label><div class="wizard-content">${content}</div><div class="wizard-bottom">${w.step > 1 ? btn('← Назад', 'wizard-back') : '<span></span>'}${w.step < 5 ? btn('Далее ' + icon('arrow'), 'wizard-next', 'primary') : ''}</div></section>`;
}
function render() { const titles = { today: 'Сегодня', week: 'Неделя', history: 'История', planning: 'Планирование' }; app.innerHTML = `<aside class="sidebar"><a class="brand" href="#" data-action="go-today"><span class="brand-icon">a<span>·</span></span><span>abitur <b>2027</b><small>МОЙ УЧЕБНЫЙ РИТМ</small></span></a><nav aria-label="Основная навигация">${Object.entries(titles).map(([key, name]) => `<button data-action="nav-${key}" class="nav-item ${tab === key ? 'active' : ''}" ${tab === key ? 'aria-current="page"' : ''}>${icon(key)}<span>${name}</span></button>`).join('')}</nav><div class="sidebar-bottom"><p>Не всё сразу.<br>По одному шагу.</p><span class="local-label"><i></i>Локально на устройстве</span></div></aside><div class="app-shell"><header class="topbar"><span class="mobile-brand">abitur <b>2027</b></span><span class="desktop-breadcrumb">Твой план подготовки</span><div class="topbar-right"><span class="offline-label">${offlineReady ? 'Доступно офлайн' : 'Мой план'}</span>${btn(icon('settings'), 'settings', 'icon-button', 'aria-label="Настройки и резервные копии"')}</div></header><main id="main">${storageError ? `<div class="notice warning"><strong>Не удалось прочитать сохранённые данные</strong><p>${esc(storageError)}</p>${btn('Восстановить данные', 'settings', 'secondary')}</div>` : ''}<div class="exam-strip"><span><i class="inf-dot"></i>Informatik <b>16 апреля 2027</b></span><span><i class="mat-dot"></i>Mathematik <b>5 мая 2027</b></span></div>${tab === 'today' ? dayView() : tab === 'week' ? weekView() : tab === 'history' ? historyView() : planningView()}<footer>В своём темпе. С ясным планом.</footer></main></div>`; }
function sessionDialog(id, contextDate) { const s = state.sessions[id]; if (!s)
    return; const p = s.plan, f = s.fact; recordDate = contextDate || (dialogId === id && recordDate ? recordDate : p.date); openDialog(p.subject, `${!isActiveSession(s) ? `<div class="notice">План отменён. Факты сохранены; это не пропуск.${btn("Восстановить в плане", "restore-removed", "text-button", `data-id="${esc(id)}"`)}</div>` : ""}<span class="module">${esc(p.module)}</span><h3>${esc(p.topic)}</h3><p>${esc(p.objective)}</p><p class="task-text">${esc(p.task)}</p><div class="dialog-time"><strong>${f.actualMinutes}<small> / ${p.plannedMinutes} мин</small></strong><span>${progress(f.actualMinutes, p.plannedMinutes)}% времени</span></div><div class="progress-track"><span style="width:${progress(f.actualMinutes, p.plannedMinutes)}%"></span></div><h4>Добавить фактическое время</h4><label class="field">Дата занятия для записи времени<input id="record-date" type="date" value="${recordDate}" required></label><div class="time-buttons">${[15, 30, 45, 60, 90].map(n => btn('+' + n, 'add-time', 'secondary', `data-id="${esc(id)}" data-minutes="${n}"`)).join('')}</div><form id="custom-time" data-id="${esc(id)}" class="inline-form"><label class="sr-only" for="minutes">Своё количество минут</label><input id="minutes" name="minutes" type="number" inputmode="numeric" min="1" max="1440" step="1" placeholder="Свои минуты" required><button class="primary" type="submit">Добавить</button></form><label class="field">Результат задания<select id="outcome" data-id="${esc(id)}">${Object.entries(OUTCOMES).map(([key, name]) => `<option value="${key}" ${f.taskOutcome === key ? 'selected' : ''}>${name}</option>`).join('')}</select></label><p class="quiet-note">Завершение задания не добавляет время. 40 минут остаются 40 минутами.</p><label class="field">Заметка<textarea id="session-notes" data-id="${esc(id)}" maxlength="10000" placeholder="Что получилось, где остановился…">${esc(f.notes)}</textarea></label>${f.timeEntries.length ? `<details><summary>Записи времени · ${f.timeEntries.length}</summary><div class="time-entries">${f.timeEntries.map(e => `<div><span><strong>+${e.minutes} мин</strong><small>${fmt(e.date)} · записано ${new Date(e.createdAt).toLocaleString('ru-RU')}</small></span>${btn('Отменить', 'undo-time', 'text-button', `data-id="${esc(id)}" data-entry="${esc(e.id)}"`)}</div>`).join('')}</div></details>` : ''}<details><summary>Задание и промпт</summary><p>Материал: ${esc(p.source)}<br>Доступность: ${esc({ available: 'доступен', unavailable: 'недоступен', unknown: 'не подтверждена', local_only: 'LOCAL_ONLY — только локально, не в Sources' }[p.sourceAccess])}</p><pre class="prompt-text">${esc(buildSessionPrompt(s))}</pre>${p.promptTarget ? `<p>Куда отправить: ${esc(p.promptTarget)}</p>` : ''}</details>${modeHint(s)}<div class="button-row">${btn("Начать в ChatGPT", "start-chatgpt", "primary", `data-id="${esc(id)}"`)}${btn(icon('copy') + ' Копировать промпт', 'copy-session', 'secondary', `data-id="${esc(id)}"`)}${p.subject !== 'Spanisch' ? projectShortcut(p.subject) : ''}</div>${isActiveSession(s) && f.taskOutcome !== 'completed' ? `<details><summary>Перенести занятие</summary><form id="move-session" data-id="${esc(id)}"><label class="field">Новая дата<input name="date" type="date" value="${p.date}" required></label><button type="submit" class="secondary">Перенести с сохранением истории</button></form></details>` : '<p class="quiet-note">Завершённое занятие остаётся на своей дате.</p>'}${btn('Управление занятием', 'session-menu', 'secondary', `data-id="${esc(id)}"`)}${s.moves.length ? `<details><summary>История переносов</summary>${s.moves.map(m => `<p>${fmt(m.from)} → ${fmt(m.to)}</p>`).join('')}</details>` : ''}`, id); }
function manualDialog(kind = 'main') { openDialog(kind === 'main' ? 'Новое занятие' : 'Дополнительная активность', `<form id="manual-session" data-kind="${kind}"><label class="field">Дата<input type="date" name="date" value="${selectedDay}" required></label><label class="field">Предмет<select name="subject">${['Informatik', 'Mathematik', 'Spanisch'].map(s => `<option ${kind === 'quizlet' && s === 'Spanisch' ? 'selected' : ''}>${s}</option>`).join('')}</select></label><div class="notice">Плановое время: ${kind === 'main' ? 60 : kind === 'quizlet' ? 15 : 30} минут. Оно фиксировано.</div><label class="field">Тема<input name="topic" maxlength="300" placeholder="Например, Übergangsgraph" required value="${kind === 'quizlet' ? 'Повторение лексики' : kind === 'simpleclub' ? 'Короткое объяснение' : ''}"></label><label class="field">Модуль<input name="module" maxlength="300" placeholder="Например, M01"></label><label class="field">Цель<input name="objective" maxlength="1000" placeholder="Что хочу научиться делать" required></label><label class="field">Задание<textarea name="task" maxlength="5000" placeholder="Конкретное действие на занятии" required></textarea></label><label class="field">Промпт (необязательно)<textarea name="prompt" maxlength="30000" placeholder="Если оставить пустым, планер составит стартовый промпт из цели и задания."></textarea></label><button type="submit" class="primary full-width">Добавить ${kind === 'main' ? '60-минутный блок' : kind === 'quizlet' ? 'Quizlet' : 'simpleclub'}</button></form>`); }
function settingsDialog() { openDialog('Настройки и данные', `${storageError ? `<div class="notice warning"><strong>Данные требуют восстановления</strong><p>${esc(storageError)}</p><p>Сохранённое содержимое не было сброшено.</p>${btn('Скачать исходные данные', 'export-raw')}</div>` : ''}<section class="settings-section"><h3>Учебные проекты ChatGPT</h3><p>Один раз вставь ссылки на свои проекты. Они сохранятся только в этом браузере; в учебный backup и пакет координатора эти настройки не включаются.</p>${projectConfigError ? `<div class="notice warning">${esc(projectConfigError)}</div>` : ''}<form id="project-config-form"><label class="field">Проект Informatik<input name="Informatik" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="2048" placeholder="https://chatgpt.com/g/…/project" value="${esc(projectConfig.projects.Informatik)}"></label><label class="field">Проект Mathematik<input name="Mathematik" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="2048" placeholder="https://chatgpt.com/g/…/project" value="${esc(projectConfig.projects.Mathematik)}"></label><button type="submit" class="primary">Сохранить ссылки на устройстве</button><div id="project-config-error" class="inline-error" role="alert"></div></form><p class="quiet-note">В Safari и приложении с экрана «Домой» настройка может потребоваться отдельно. Для Spanisch ссылка не требуется.</p></section><section class="settings-section"><h3>Открывать ChatGPT как приложение</h3><p>Необязательно: в «Командах» iPhone создай команду <strong>Abitur ChatGPT</strong> с действием «Открыть приложение → ChatGPT» и сохрани с этим точным именем.</p><p>Команда только открывает приложение. Вставка текста, выбор проекта и режима, прикрепление файла и отправка остаются за тобой.</p>${launchConfig.error ? `<p class="inline-error">${esc(launchConfig.error)}</p>` : ''}<form id="chatgpt-launch-form"><label class="check-field"><input id="shortcut-enabled" name="shortcut-enabled" type="checkbox" ${launchConfig.config.shortcutEnabled ? 'checked' : ''}>Я создал команду Abitur ChatGPT; показывать ссылку запуска</label><button type="submit" class="secondary">Сохранить способ открытия</button></form>${launchConfig.config.shortcutEnabled ? `<p><a class="button secondary" href="${SHORTCUT_URL}">Проверить запуск команды</a></p>` : ''}<p class="quiet-note">Работа из установленной PWA зависит от iOS и требует проверки на твоём iPhone. Если переход не сработает, скопируй промпт и открой ChatGPT вручную. Настройка хранится отдельно на этом устройстве.</p></section><section class="settings-section"><h3>Резервная копия</h3><p>История хранится только в этом браузере. Скачивай копию после учебной недели и перед переносом на другой телефон.</p>${btn(icon('download') + ' Экспорт полного backup', 'export-backup', 'primary', storageError ? 'disabled' : '')}</section><section class="settings-section"><h3>Восстановление</h3><p>Сначала покажем содержимое копии. Замена произойдёт только после подтверждения.</p><label class="button secondary file-label">Выбрать backup JSON<input type="file" accept=".json,application/json" id="backup-file"></label><label class="field">Или вставь JSON<textarea id="backup-text" maxlength="10485760" placeholder="Полная резервная копия…"></textarea></label>${btn('Проверить резервную копию', 'check-backup')}<div id="backup-error" class="inline-error" role="alert"></div><div id="backup-preview"></div></section><section class="settings-section"><h3>На iPhone</h3><p>Для опубликованной версии: Safari → Поделиться → На экран Домой. Для обновления закрой все окна планера и открой его снова. Перед обновлением скачай backup.</p><p>Safari и приложение на экране Домой могут иметь разные данные. Для переноса используй экспорт и восстановление.</p><p class="quiet-note">${offlineReady ? 'Файлы приложения закэшированы для офлайн-открытия.' : 'Для офлайн-режима нужна собранная версия и первая успешная загрузка всех файлов.'} Данные сайта могут быть очищены системой; резервная копия нужна отдельно.</p></section>${storageError ? `<details><summary>Начать заново</summary><p>Только после сохранения исходных данных. Это заменит текущую запись пустым планером.</p><label class="check-field"><input type="checkbox" id="reset-confirm">Я сохранил исходные данные и подтверждаю замену</label>${btn('Создать пустое состояние', 'reset-corrupt', 'secondary')}</details>` : ''}`); }
function backupPreviewHtml() { if (!backupPreview)
    return; const entries = Object.values(backupPreview.sessions); modal.querySelector('#backup-preview').innerHTML = `<div class="notice"><strong>Резервная копия проверена</strong><p>${entries.length} занятий · ${Object.keys(backupPreview.deletedSessions).length} записей об удалении · ${entries.reduce((n, s) => n + s.fact.actualMinutes, 0)} фактических минут · шаг мастера ${backupPreview.wizard.step}.</p><p>Все текущие данные будут заменены содержимым копии. Рекомендуется сначала скачать текущий backup.</p><label class="check-field"><input id="restore-confirm" type="checkbox">Подтверждаю замену текущих данных</label>${btn('Восстановить из этой копии', 'restore-backup', 'primary')}</div>`; }
function checkPlan() { clearPlanPreview(); try {
    preview = parseWeekPlan(state.wizard.importDraft);
    if (preview.weekStart !== state.wizard.weekStart)
        throw new Error(`В файле неделя с ${fmt(preview.weekStart)}. Выберите этот понедельник вверху мастера или исправьте JSON.`);
    render();
}
catch (e) {
    preview = null;
    const el = document.querySelector('#import-error');
    if (el)
        el.textContent = e.message;
} }
function addMinutes(id, minutes) { const now = Date.now(); if ((timeLocks.get(id) || 0) > now) {
    toast('Время уже добавлено. Подождите секунду перед следующим добавлением.');
    return;
} try {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
        throw new Error('Введите целое число от 1 до 1440 минут.');
    if (updateSession(id, s => addTime(s, minutes, undefined, recordDate || s.plan.date))) {
        timeLocks.set(id, now + 900);
        sessionDialog(id);
        toast(`Добавлено ${minutes} мин`);
    }
}
catch (e) {
    toast(e.message);
} }
document.addEventListener('click', async (e) => {
    const element = e.target.closest('[data-action]');
    if (!element)
        return;
    e.preventDefault();
    const action = element.dataset.action, id = element.dataset.id;
    if (action.startsWith('nav-')) {
        tab = action.slice(4);
        if (tab === 'today')
            selectedDay = today;
        render();
        window.scrollTo(0, 0);
        return;
    }
    if (action === 'close') {
        closeDialog();
        return;
    }
    if (action === 'settings') {
        settingsDialog();
        return;
    }
    if (action === 'go-today') {
        tab = 'today';
        selectedDay = today;
        render();
        return;
    }
    if (action === 'open-day') {
        selectedDay = element.dataset.date;
        tab = 'today';
        closeDialog();
        render();
        window.scrollTo(0, 0);
        return;
    }
    if (action === 'week-prev' || action === 'week-next') {
        selectedWeek = addDays(selectedWeek, action === 'week-prev' ? -7 : 7);
        render();
        return;
    }
    if (action === 'week-current') {
        selectedWeek = monday(today);
        render();
        return;
    }
    if (action === 'month-prev' || action === 'month-next') {
        const date = new Date(selectedMonth + 'T12:00:00');
        date.setMonth(date.getMonth() + (action === 'month-prev' ? -1 : 1));
        selectedMonth = localDate(date);
        render();
        return;
    }
    if (action === 'stats-week' || action === 'stats-month') {
        monthStats = action === 'stats-month';
        render();
        return;
    }
    if (action === 'add-main') {
        manualDialog();
        return;
    }
    if (action === 'add-extra') {
        manualDialog(element.dataset.kind);
        return;
    }
    if (action === 'edit') {
        sessionDialog(id, element.dataset.recordDate || (tab === 'today' && selectedDay === state.sessions[id].plan.date ? selectedDay : undefined));
        return;
    }
    if (action === 'add-time') {
        addMinutes(id, Number(element.dataset.minutes));
        return;
    }
    if (action === 'undo-time') {
        if (updateSession(id, s => removeTime(s, element.dataset.entry))) {
            sessionDialog(id);
            toast('Запись времени отменена');
        }
        return;
    }
    if (action === 'copy-session') {
        await copy(buildSessionPrompt(state.sessions[id]));
        return;
    }
    if (action === 'session-menu') {
        sessionMenu(id);
        return;
    }
    if (action === 'remove-session') {
        removeSessionDialog(id);
        return;
    }
    if (action === 'confirm-remove-session') {
        if (!modal.querySelector('#remove-confirm')?.checked) {
            toast('Подтверди действие с занятием.');
            return;
        }
        if (commit(s => removeSessionFromPlan(s, pendingRemoval))) {
            closeDialog();
            toast('План обновлён. Фактическая история сохранена.');
        }
        return;
    }
    if (action === 'restore-removed') {
        restoreSessionDialog(id);
        return;
    }
    if (action === 'confirm-restore-session') {
        if (!modal.querySelector('#restore-session-confirm')?.checked) {
            toast('Подтверди восстановление.');
            return;
        }
        if (commit(s => restoreRemovedSession(s, pendingRestore))) {
            closeDialog();
            toast('Занятие восстановлено в плане.');
        }
        return;
    }
    if (action === 'remove-week') {
        removalWeekDialog(element.dataset.week);
        return;
    }
    if (action === 'confirm-remove-week') {
        if (!modal.querySelector('#remove-week-confirm')?.checked) {
            toast('Подтверди показанные изменения.');
            return;
        }
        if (commit(s => removeWeekPlan(s, pendingRemovalWeek))) {
            closeDialog();
            toast('План обновлён; проведённая работа сохранена.');
        }
        return;
    }
    if (action === 'start-chatgpt') {
        await startChatGPT(id);
        return;
    }
    if (action === 'select-prompt') {
        selectPrompt();
        return;
    }
    if (action === 'manual-copy-ready') {
        if (!modal.querySelector('#manual-copy-confirm')?.checked) {
            toast('Сначала скопируй текст и подтверди это.');
            return;
        }
        openDialog('Открыть ChatGPT', launchLinks(state.sessions[id]?.plan.subject));
        return;
    }
    if (action === 'copy-coordinator-data') {
        try {
            const text = buildCoordinatorRequest(state);
            const ok = await copy(text);
            if (!ok) {
                modal.querySelector('.dialog-body').insertAdjacentHTML('beforeend', `<p>Запасной способ: скачай JSON и прикрепи его вручную вместе с отдельными инструкциями координатора.</p>${btn('Скачать planning_bundle.json', 'export-bundle')}${btn('Копировать инструкции', 'copy-coordinator')}`);
            }
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
    if (action === 'copy-handoff') {
        await copy(handoffPrompt(element.dataset.subject, addDays(state.wizard.weekStart, -7)));
        return;
    }
    if (action === 'wizard-back') {
        commit(s => { s.wizard.step = Math.max(1, s.wizard.step - 1); return s; });
        return;
    }
    if (action === 'wizard-next') {
        const w = state.wizard, report = w.step === 2 ? w.informatik : w.step === 3 ? w.mathematik : null;
        if (report && !report.text.trim() && !report.unavailable) {
            toast('Вставьте отчёт или отметьте отсутствие подтверждённых данных.');
            return;
        }
        commit(s => { s.wizard.step = Math.min(5, s.wizard.step + 1); return s; });
        window.scrollTo(0, 0);
        return;
    }
    if (action === 'confirm-week') {
        clearPlanPreview();
        commit(s => { s.wizard = { ...s.wizard, step: 1, weekStart: pendingWeek, informatik: { text: '', unavailable: false }, mathematik: { text: '', unavailable: false }, importDraft: '' }; return s; });
        closeDialog();
        return;
    }
    if (action === 'copy-coordinator') {
        await copy(coordinatorPrompt());
        return;
    }
    if (action === 'export-bundle') {
        try {
            download('planning_bundle.json', JSON.stringify(buildBundle(state), null, 2));
            toast('Файл итогов подготовлен');
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
    if (action === 'check-import') {
        checkPlan();
        return;
    }
    if (action === 'cancel-import') {
        preview = null;
        render();
        return;
    }
    if (action === 'apply-import' && preview) {
        const plan = preview;
        if (commit(s => applyImport(s, plan, true))) {
            selectedWeek = plan.weekStart;
            preview = null;
            tab = 'week';
            render();
            toast('План сохранён. Фактические записи сохранены.');
        }
        return;
    }
    if (action === 'export-backup') {
        try {
            download(`abitur-backup-${today}.json`, serializeBackup(state));
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
    if (action === 'export-raw') {
        download('abitur-recovery-raw.json', recoveryRaw);
        return;
    }
    if (action === 'check-backup') {
        clearBackupCandidate();
        try {
            backupPreview = parseBackup(modal.querySelector('#backup-text').value);
            backupPreviewHtml();
            modal.querySelector('#backup-error').textContent = '';
        }
        catch (e) {
            backupPreview = null;
            modal.querySelector('#backup-preview').innerHTML = '';
            modal.querySelector('#backup-error').textContent = e.message;
        }
        return;
    }
    if (action === 'restore-backup' && backupPreview) {
        if (!modal.querySelector('#restore-confirm')?.checked) {
            toast('Подтвердите замену данных.');
            return;
        }
        try {
            state = replaceState(backupPreview);
            storageError = '';
            backupPreview = null;
            preview = null;
            closeDialog();
            render();
            toast('Резервная копия восстановлена');
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
    if (action === 'reset-corrupt') {
        if (!modal.querySelector('#reset-confirm').checked) {
            toast('Сначала подтвердите замену.');
            return;
        }
        try {
            const fresh = emptyState(today);
            state = replaceState(fresh);
            storageError = '';
            closeDialog();
            render();
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
});
document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'backup-text')
        clearBackupCandidate();
    if (t.dataset.wizard) {
        const key = t.dataset.wizard;
        commit(s => { s.wizard[key].text = t.value; return s; }, false);
    }
    if (t.hasAttribute('data-preferences'))
        commit(s => { s.wizard.preferences = t.value; return s; }, false);
    if (t.hasAttribute('data-import-draft')) {
        clearPlanPreview();
        commit(s => { s.wizard.importDraft = t.value; return s; }, false);
    }
    if (t.id === 'session-notes')
        commit(s => { s.sessions[t.dataset.id].fact.notes = t.value; return s; }, false);
});
document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'outcome') {
        if (updateSession(t.dataset.id, s => setOutcome(s, t.value))) {
            sessionDialog(t.dataset.id);
            toast('Результат сохранён');
        }
    }
    if (t.id === 'record-date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(t.value))
            recordDate = t.value;
    }
    if (t.dataset.unavailable) {
        const key = t.dataset.unavailable;
        commit(s => { s.wizard[key].unavailable = t.checked; return s; });
    }
    if (t.id === 'target-week') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(t.value) || monday(t.value) !== t.value) {
            toast('Выберите понедельник.');
            t.value = state.wizard.weekStart;
            return;
        }
        if (t.value === state.wizard.weekStart)
            return;
        pendingWeek = t.value;
        t.value = state.wizard.weekStart;
        if (state.wizard.informatik.text || state.wizard.mathematik.text || state.wizard.informatik.unavailable || state.wizard.mathematik.unavailable || state.wizard.importDraft) {
            openDialog('Начать другую неделю?', `<p>Отчёты относятся к прошлому выбранному периоду. Для недели с ${fmt(pendingWeek)} мастер начнётся с первого шага, отчёты и черновик импорта будут очищены. История занятий и пожелания сохранятся.</p><p>При необходимости скачай полную резервную копию перед сменой недели.</p><div class="button-row">${btn('Скачать backup', 'export-backup')}${btn('Начать выбранную неделю', 'confirm-week', 'primary')}${btn('Оставить текущую', 'close')}</div>`);
        }
        else {
            clearPlanPreview();
            commit(s => { s.wizard.weekStart = pendingWeek; s.wizard.step = 1; return s; });
        }
    }
    if (t.id === 'plan-file' || t.id === 'backup-file') {
        const file = t.files?.[0];
        if (!file)
            return;
        if (t.id === 'plan-file')
            clearPlanPreview();
        else
            clearBackupCandidate();
        try {
            const limit = t.id === 'plan-file' ? 2 : 10;
            if (file.size > limit * 1024 * 1024)
                throw new Error(`Файл слишком большой. Максимум ${limit} МБ.`);
            const raw = await file.text();
            if (t.id === 'plan-file') {
                if (commit(s => { s.wizard.importDraft = raw; return s; }))
                    checkPlan();
            }
            else {
                backupPreview = parseBackup(raw);
                backupPreviewHtml();
            }
        }
        catch (e) {
            const el = document.querySelector(t.id === 'plan-file' ? '#import-error' : '#backup-error');
            if (el)
                el.textContent = e.message;
        }
    }
});
document.addEventListener('submit', e => {
    const f = e.target;
    e.preventDefault();
    const data = new FormData(f);
    if (f.id === 'chatgpt-launch-form') {
        try {
            saveChatGPTLaunchConfig({ version: 1, shortcutEnabled: data.get('shortcut-enabled') === 'on' });
            launchConfig = loadChatGPTLaunchConfig();
            settingsDialog();
            toast('Способ открытия сохранён на устройстве');
        }
        catch (error) {
            toast(error.message);
        }
        return;
    }
    if (f.id === 'project-config-form') {
        try {
            saveProjectConfig({ version: 1, projects: { Informatik: String(data.get('Informatik') || ''), Mathematik: String(data.get('Mathematik') || '') } });
            const loaded = loadProjectConfig();
            if (loaded.error)
                throw new Error(loaded.error);
            projectConfig = loaded.config;
            projectConfigError = '';
            render();
            settingsDialog();
            toast('Ссылки сохранены на устройстве');
        }
        catch (error) {
            const target = modal.querySelector('#project-config-error');
            if (target)
                target.textContent = error.message;
        }
        return;
    }
    if (f.id === 'custom-time') {
        addMinutes(f.dataset.id, Number(data.get('minutes')));
        return;
    }
    if (f.id === 'move-session') {
        try {
            if (updateSession(f.dataset.id, s => moveSession(s, String(data.get('date'))))) {
                sessionDialog(f.dataset.id);
                toast('Занятие перенесено');
            }
        }
        catch (e) {
            toast(e.message);
        }
        return;
    }
    if (f.id === 'manual-session') {
        const kind = f.dataset.kind, subject = data.get('subject'), date = String(data.get('date')), topic = String(data.get('topic')).trim(), objective = String(data.get('objective')).trim(), task = String(data.get('task')).trim();
        if (!topic || !objective || !task) {
            toast('Заполните тему, цель и задание.');
            return;
        }
        const p = { id: crypto.randomUUID(), date, kind, subject, module: String(data.get('module')).trim() || 'Личный план', topic, objective, task, source: kind === 'main' ? 'Материал будет уточнён на занятии' : kind === 'quizlet' ? 'Мой набор Quizlet' : 'simpleclub Free', sourceAccess: 'unknown', plannedMinutes: kind === 'main' ? 60 : kind === 'quizlet' ? 15 : 30, prompt: String(data.get('prompt')).trim() || `Начинаем ${kind === 'main' ? '60' : kind === 'quizlet' ? '15' : '30'}-минутное занятие ${subject}. Тема: ${topic}. Цель: ${objective}. Задание: ${task}. Сначала проверь доступность материала. Не придумывай историю прогресса. Давай задания по одному; отделяй мои самостоятельные решения от подсказок. В конце кратко зафиксируй результат и следующий шаг.`, promptTarget: subject === 'Spanisch' ? 'NotebookLM или обычный ChatGPT' : `ChatGPT Project ${subject}` };
        if (commit(s => { s.sessions[p.id] = makeSession(p); return s; })) {
            selectedDay = date;
            tab = 'today';
            closeDialog();
            render();
            toast('Занятие добавлено');
        }
    }
});
modal.addEventListener('click', e => { if (e.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
        closeDialog();
} });
window.addEventListener('storage', e => { if (e.key === CHATGPT_LAUNCH_KEY) {
    launchConfig = loadChatGPTLaunchConfig();
    if (modal.open && modal.querySelector('#chatgpt-launch-form'))
        settingsDialog();
} if (e.key === PROJECT_CONFIG_KEY) {
    const current = loadProjectConfig();
    projectConfig = current.config;
    projectConfigError = current.error || '';
    render();
    if (modal.open && modal.querySelector('#project-config-form'))
        settingsDialog();
} if (e.key === STORAGE_KEY) {
    const current = loadState();
    state = current.state;
    storageError = current.error || '';
    recoveryRaw = current.raw || '';
    preview = null;
    backupPreview = null;
    closeDialog();
    render();
    toast('Данные обновлены в другой вкладке.');
} });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && localDate() !== today) {
    today = localDate();
    selectedDay = today;
    render();
} });
render();
if ('serviceWorker' in navigator && true) {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: './' }).then(async (registration) => { await navigator.serviceWorker.ready; registration.active?.postMessage('CHECK_OFFLINE'); if (registration.waiting)
        toast('Доступно обновление. Закройте все окна планера и откройте его снова.'); }).catch(() => toast('Офлайн-кэш пока недоступен. Приложение работает при подключении.'));
    navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'OFFLINE_UNAVAILABLE') {
        offlineReady = false;
        const label = document.querySelector('.offline-label');
        if (label)
            label.textContent = 'Офлайн-кэш недоступен';
    } if (event.data?.type === 'OFFLINE_READY') {
        offlineReady = true;
        const label = document.querySelector('.offline-label');
        if (label)
            label.textContent = 'Доступно офлайн';
    } });
}
