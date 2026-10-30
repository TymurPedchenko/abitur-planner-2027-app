import { emptyState } from "./model.js";
import { validateState, MAX_BACKUP_BYTES } from "./validation.js";
export const STORAGE_KEY = 'abitur2027.planner.v1';
export const RECOVERY_KEY = 'abitur2027.planner.recovery';
function message(error) { return error instanceof Error ? error.message : String(error); }
function storedState(raw) {
    if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES)
        throw new Error('Сохранённые данные превышают допустимый размер.');
    const value = JSON.parse(raw);
    validateState(value);
    return value;
}
export function loadState() {
    let raw = null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null)
            return { state: emptyState() };
        return { state: storedState(raw) };
    }
    catch (error) {
        return { state: emptyState(), error: `Не удалось открыть сохранённые данные. Они не были удалены. ${message(error)}`, ...(raw === null ? {} : { raw }) };
    }
}
function write(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    catch {
        throw new Error('Не удалось сохранить данные на устройстве. Возможно, хранилище переполнено или недоступно. Изменения не применены. Сохраните резервную копию.');
    }
}
export function saveState(state) {
    validateState(state);
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    }
    catch {
        throw new Error('Локальное хранилище недоступно. Изменения не сохранены.');
    }
    let current = null;
    if (raw !== null) {
        try {
            current = storedState(raw);
        }
        catch {
            throw new Error('Сохранённые данные повреждены или имеют неизвестную версию. Сначала скачайте исходные данные и используйте восстановление.');
        }
    }
    if ((current?.revision ?? 0) !== state.revision)
        throw new Error('Данные изменились в другом окне. Обновите страницу перед следующим изменением.');
    const next = { ...state, revision: state.revision + 1 };
    write(next);
    state.revision = next.revision;
}
/** Call only after a preview and explicit user confirmation. Previous raw bytes are retained. */
export function replaceState(state) {
    validateState(state);
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    }
    catch {
        throw new Error('Хранилище недоступно. Восстановление не выполнено.');
    }
    let revision = state.revision;
    if (raw !== null) {
        try {
            revision = storedState(raw).revision;
        }
        catch { /* Keep a future or corrupt format untouched in recovery. */ }
        try {
            localStorage.setItem(RECOVERY_KEY, raw);
        }
        catch {
            throw new Error('Не удалось сохранить защитную копию текущих данных. Восстановление отменено; прежние данные не изменены. Скачайте их и освободите место.');
        }
    }
    const next = structuredClone(state);
    next.revision = revision + 1;
    write(next);
    return next;
}
export function serializeBackup(state) {
    validateState(state);
    return JSON.stringify({ backupVersion: 1, exportedAt: new Date().toISOString(), state }, null, 2);
}
