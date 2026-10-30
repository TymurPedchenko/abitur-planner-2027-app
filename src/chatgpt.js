/** Public, documented Apple scheme. Never carries the prompt, a project URL or a file. */
export const SHORTCUT_NAME = 'Abitur ChatGPT';
export const SHORTCUT_URL = 'shortcuts://run-shortcut?name=Abitur%20ChatGPT';
export const CHATGPT_WEB_URL = 'https://chatgpt.com/';
/** An application fallback threshold, not a claimed iOS/ChatGPT clipboard limit. */
export const MAX_AUTOMATIC_COPY_BYTES = 256 * 1024;
export const MODEL_RECOMMENDATION_NOTICE = 'Это рекомендация, а не выбор модели. Названия и доступность режимов зависят от версии ChatGPT и подписки. Выбери подходящий режим вручную.';
export function recommendChatGPTMode(plan) {
    const text = [plan.topic, plan.objective, plan.task, plan.prompt].join('\n');
    // A local, transparent hint only. No assessment of mastery or remote model control.
    const demanding = /многошагов|многоэтап|сложн[а-яё]*\s+(?:задач|разбор|доказательств)|подробн[а-яё]*\s+разбор|(?:больш|развёрнут|развернут)[а-яё]*\s+(?:письменн|решени)|провер[а-яё]*\s+(?:больш|развёрнут|развернут)[а-яё]*|mehrschritt|mehrstufig|ausführlich[\wäöüß]*\s+(?:Lösung|Analyse)|umfangreich[\wäöüß]*\s+(?:Lösung|Aufgabe)/iu.test(text);
    return {
        mode: demanding ? 'High' : 'Medium',
        reason: demanding ? 'В задании указан подробный или многошаговый разбор. Рекомендацию можно изменить.' : 'Обычное занятие, объяснение, диагностика или стандартная проверка. Для сложного письменного решения можно выбрать High.',
        notice: MODEL_RECOMMENDATION_NOTICE,
    };
}
export function buildSessionPrompt(session) {
    const p = session.plan;
    // Older valid plans can describe LOCAL_ONLY in the source or prompt, before a dedicated enum existed.
    const localOnly = String(p.sourceAccess).toLowerCase() === 'local_only' || /\bLOCAL_ONLY\b/i.test(p.source + '\n' + p.prompt);
    const access = localOnly ? 'LOCAL_ONLY — оригинал находится только локально, не в Sources проекта.' : p.sourceAccess === 'available' ? 'available — источник отмечен доступным в плане; сначала подтверди фактическую доступность.' : p.sourceAccess === 'unavailable' ? 'unavailable — источник не предоставлен.' : 'unknown — доступность источника не подтверждена.';
    return `Учебное занятие подготовки к Abitur 2027.
Предмет: ${p.subject}.
Идентификатор занятия: ${p.id}.
Модуль: ${p.module}.
Тема: ${p.topic}.
Цель: ${p.objective}
Плановое время блока: ${p.plannedMinutes} минут. Не уменьшай плановое время ради процента выполнения.
Уже записанное фактическое время: ${session.fact.actualMinutes} минут. Это не доказательство освоения темы. Текущий доступный отрезок времени уточни у ученика, если он отличается от плана.
Конкретное задание: ${p.task}
Источник: ${p.source.trim() || 'Не указан'}
Доступность: ${access}
${localOnly ? 'Не проси проверить отсутствующий PDF по названию. Оригинальное условие не находится в Sources проекта: ученик должен открыть его локально или отдельно предоставить разрешённый материал. Не утверждай, что прочитал файл.' : 'Не утверждай, что видел файл, которого нет в доступном контексте. Если оригинальное условие нужно, а источник отсутствует, попроси ученика открыть его локально или предоставить разрешённый материал.'}

Сначала дай возможность решить самостоятельно. Подсказки по порядку: уточняющий вопрос → короткий намёк → пояснение конкретного шага → пример по запросу. Не выдавай готовое решение раньше самостоятельной попытки, если ученик не попросил его явно.
${p.kind === 'main' ? 'Если уровень в новом модуле неизвестен, начни с практической диагностики на 10–20 минут внутри этого блока. При самостоятельном решении переходи к следующей сложности; при конкретной ошибке разбери её. Не начинай весь курс с нуля без основания.' : 'Это дополнительная активность, а не основной блок. Соблюдай её указанную длительность; не заменяй ею основные занятия и не добавляй отдельную длинную диагностику.'}
Различай самостоятельное решение, помощь и неизвестный уровень. Не называй авторские упражнения официальными заданиями Abitur. Объясняй по-русски; Fachbegriffe и Operatoren оставляй на немецком.
Завершение раньше плана допустимо: сохрани реальные минуты и конкретный результат, не приписывай новые знания. В конце кратко зафиксируй выполненное, самостоятельность, помощь, ошибки, незавершённое и следующий шаг.

Сохранённый промпт занятия (передан полностью; не является подтверждением доступности файлов или прогресса):
${p.prompt}`;
}
/** No DOM insertion, networking, navigation or automatic message sending. */
export async function copyPrompt(text, clipboard) {
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_AUTOMATIC_COPY_BYTES)
        return { ok: false, text, bytes, reason: 'too-large' };
    try {
        const writer = clipboard === undefined ? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined) : clipboard;
        if (!writer || typeof writer.writeText !== 'function')
            return { ok: false, text, bytes, reason: 'unavailable' };
        await writer.writeText(text);
        return { ok: true, text, bytes };
    }
    catch {
        return { ok: false, text, bytes, reason: 'rejected' };
    }
}
