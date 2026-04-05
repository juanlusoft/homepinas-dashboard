/**
 * HomePiNAS — Internacionalización (i18n)
 * Soporta: es (español, defecto) / en (inglés)
 *
 * API:
 *   initI18n()         — carga el idioma guardado o el del navegador
 *   t(key, fallback)   — traduce una clave con notación de puntos ('auth.login')
 *   applyTranslations()— aplica traducciones a elementos con [data-i18n]
 *   getCurrentLang()   — devuelve el idioma activo ('es' | 'en')
 *   setLang(lang)      — cambia de idioma y recarga las traducciones
 */

const SUPPORTED = ['es', 'en'];
const STORAGE_KEY = 'homepinas_lang';

let _lang = 'es';
let _translations = {};

/**
 * Resuelve una clave de notación de puntos en el objeto de traducciones.
 * @param {string} key  - 'auth.login'
 * @param {object} obj  - objeto de traducciones
 * @returns {string|undefined}
 */
function _resolve(key, obj) {
    return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/**
 * Carga el archivo JSON del idioma indicado.
 * @param {string} lang
 * @returns {Promise<object>}
 */
async function _load(lang) {
    try {
        const res = await fetch(`/frontend/${lang}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.warn(`[i18n] Could not load ${lang}.json:`, e.message);
        return {};
    }
}

/**
 * Devuelve el idioma preferido del navegador si está soportado, o 'es'.
 * @returns {string}
 */
function _detectBrowserLang() {
    const nav = (navigator.language || navigator.userLanguage || 'es').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(nav) ? nav : 'es';
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Inicializa el sistema i18n. Debe llamarse antes de renderizar la UI.
 * Lee la preferencia guardada en localStorage o detecta el idioma del navegador.
 */
export async function initI18n() {
    const saved = localStorage.getItem(STORAGE_KEY);
    _lang = SUPPORTED.includes(saved) ? saved : _detectBrowserLang();
    _translations = await _load(_lang);
    applyTranslations();
}

/**
 * Traduce una clave. Si no se encuentra, devuelve el fallback o la clave en sí.
 * @param {string} key       - 'auth.login'
 * @param {string} [fallback]- texto por defecto si la clave no existe
 * @returns {string}
 */
export function t(key, fallback) {
    const val = _resolve(key, _translations);
    if (typeof val === 'string') return val;
    return fallback !== undefined ? fallback : key;
}

/**
 * Aplica traducciones a todos los elementos del DOM con [data-i18n].
 * El valor del atributo es la clave de traducción.
 * @example <span data-i18n="nav.docker"></span>
 */
export function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = _resolve(key, _translations);
        if (typeof val === 'string') el.textContent = val;
    });
}

/**
 * Devuelve el idioma actualmente activo.
 * @returns {'es'|'en'}
 */
export function getCurrentLang() {
    return _lang;
}

/**
 * Cambia el idioma, guarda la preferencia y vuelve a cargar las traducciones.
 * @param {'es'|'en'} lang
 */
export async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    _lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    _translations = await _load(_lang);
    applyTranslations();
}
