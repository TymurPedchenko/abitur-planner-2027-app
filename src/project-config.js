export const PROJECT_CONFIG_KEY = 'abitur2027.planner.projects.v1';
/** Separate opt-in so saving legacy project links cannot reset a launch preference. */
export const CHATGPT_LAUNCH_KEY = 'abitur2027.planner.chatgpt-launch.v1';
const SUBJECTS = ['Informatik', 'Mathematik'];
const MAX_CONFIG_BYTES = 8192;
export function emptyProjectConfig() {
    return { version: 1, projects: { Informatik: '', Mathematik: '' } };
}
/** Accept only a project page, not shared chats, external redirects, credentials, or schemes. */
export function validateProjectUrl(raw) {
    if (typeof raw !== 'string')
        throw new Error('Ссылка проекта должна быть текстом.');
    const value = raw.trim();
    if (!value)
        return '';
    if (value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value))
        throw new Error('Ссылка проекта содержит недопустимые символы или слишком длинная.');
    // The literal route check also rejects URL-parser normalization of backslashes,
    // dot segments, explicit ports, credentials, and encoded project-path characters.
    const route = /^https:\/\/chatgpt\.com\/g\/g-p-([A-Za-z0-9-]+)\/project\/?(?:[?#].*)?$/.exec(value);
    if (!route)
        throw new Error('Вставьте HTTPS-ссылку на страницу проекта ChatGPT вида chatgpt.com/g/g-p-…/project.');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Не удалось прочитать ссылку проекта.');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.port || url.username || url.password) {
        throw new Error('Разрешены только ссылки проектов на chatgpt.com без логина, пароля и порта.');
    }
    // Query and fragment can carry navigation or tracking details. The shortcut needs neither.
    return `https://chatgpt.com/g/g-p-${route[1]}/project`;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value, expected) {
    const keys = Object.keys(value);
    return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function normalizedConfig(value) {
    if (!isRecord(value) || !exactKeys(value, ['version', 'projects']) || value.version !== 1 ||
        !isRecord(value.projects) || !exactKeys(value.projects, SUBJECTS)) {
        throw new Error('Настройки ссылок повреждены или имеют неподдерживаемую версию.');
    }
    const config = emptyProjectConfig();
    for (const subject of SUBJECTS) {
        const raw = value.projects[subject];
        if (typeof raw !== 'string')
            throw new Error('Настройки ссылок содержат неверное значение.');
        config.projects[subject] = validateProjectUrl(raw);
    }
    return config;
}
export function loadProjectConfig() {
    try {
        const raw = localStorage.getItem(PROJECT_CONFIG_KEY);
        if (raw === null)
            return { config: emptyProjectConfig() };
        if (new TextEncoder().encode(raw).byteLength > MAX_CONFIG_BYTES)
            throw new Error('Настройки ссылок превышают допустимый размер.');
        return { config: normalizedConfig(JSON.parse(raw)) };
    }
    catch {
        // Keep the original bytes and all study data. Only an explicit Save can replace config.
        return { config: emptyProjectConfig(), error: 'Не удалось прочитать локальные ссылки проектов. Они не удалены. Проверьте и сохраните ссылки заново; история занятий не изменена.' };
    }
}
export function saveProjectConfig(config) {
    const next = normalizedConfig(config);
    try {
        localStorage.setItem(PROJECT_CONFIG_KEY, JSON.stringify(next));
    }
    catch {
        throw new Error('Не удалось сохранить ссылки на устройстве. Прежние настройки и история занятий не изменены.');
    }
}
export function emptyChatGPTLaunchConfig() {
    return { version: 1, shortcutEnabled: false };
}
function normalizedLaunchConfig(value) {
    if (!isRecord(value) || !exactKeys(value, ['version', 'shortcutEnabled']) || value.version !== 1 || typeof value.shortcutEnabled !== 'boolean') {
        throw new Error('Настройка запуска ChatGPT повреждена или имеет неизвестную версию.');
    }
    return { version: 1, shortcutEnabled: value.shortcutEnabled };
}
export function loadChatGPTLaunchConfig() {
    try {
        const raw = localStorage.getItem(CHATGPT_LAUNCH_KEY);
        if (raw === null)
            return { config: emptyChatGPTLaunchConfig() };
        if (new TextEncoder().encode(raw).byteLength > MAX_CONFIG_BYTES)
            throw new Error('Настройка слишком большая.');
        return { config: normalizedLaunchConfig(JSON.parse(raw)) };
    }
    catch {
        return { config: emptyChatGPTLaunchConfig(), error: 'Не удалось прочитать настройку запуска ChatGPT. Исходные данные не удалены; открытие и копирование вручную доступны.' };
    }
}
export function saveChatGPTLaunchConfig(config) {
    const next = normalizedLaunchConfig(config);
    try {
        localStorage.setItem(CHATGPT_LAUNCH_KEY, JSON.stringify(next));
    }
    catch {
        throw new Error('Не удалось сохранить настройку запуска ChatGPT. Прежние настройки не изменены.');
    }
}
