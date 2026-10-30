import { emptyState } from "./model.js";
import { validateState, migrateState, MAX_BACKUP_BYTES } from "./validation.js";
export const STORAGE_KEY = 'abitur2027.planner.v1';
export const RECOVERY_KEY = 'abitur2027.planner.recovery';
export const PRE_V2_KEY = 'abitur2027.planner.pre-v2';
function message(error) { return error instanceof Error ? error.message : String(error); }
function storedState(raw) {
    if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES)
        throw new Error('Сохранённые данные превышают допустимый размер.');
    return migrateState(JSON.parse(raw));
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
    const raw = JSON.stringify(state);
    // Include the envelope, not just state bytes: every newly saved state must round-trip through its backup.
    if (new TextEncoder().encode(compactBackup(state)).byteLength > MAX_BACKUP_BYTES)
        throw new Error('Данные вместе с резервной копией превышают допустимый размер. Изменения не сохранены; экспортируйте текущую резервную копию.');
    try {
        localStorage.setItem(STORAGE_KEY, raw);
    }
    catch {
        throw new Error('Не удалось сохранить данные на устройстве. Возможно, хранилище переполнено или недоступно. Изменения не применены. Сохраните резервную копию.');
    }
}
function preserveOriginalV1(raw) {
    if (raw === null)
        return;
    let version;
    try {
        version = JSON.parse(raw)?.version;
    }
    catch {
        return;
    }
    if (version !== 1)
        return;
    try {
        if (localStorage.getItem(PRE_V2_KEY) === null)
            localStorage.setItem(PRE_V2_KEY, raw);
    }
    catch {
        throw new Error('Не удалось сохранить защитную копию старого формата. Обновление данных отменено; скачайте backup и освободите место.');
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
    preserveOriginalV1(raw);
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
    preserveOriginalV1(raw);
    const next = structuredClone(state);
    next.revision = revision + 1;
    write(next);
    return next;
}
export function serializeBackup(state) {
    validateState(state);
    const compact = compactBackup(state);
    if (new TextEncoder().encode(compact).byteLength > MAX_BACKUP_BYTES)
        throw new Error('Полная резервная копия превышает допустимый размер. Экспорт не выполнен; исходные данные не изменены и не обрезаны.');
    const pretty = JSON.stringify(JSON.parse(compact), null, 2);
    return new TextEncoder().encode(pretty).byteLength <= MAX_BACKUP_BYTES ? pretty : compact;
}
function compactBackup(state) { return JSON.stringify({ backupVersion: 2, exportedAt: new Date().toISOString(), state }); }
