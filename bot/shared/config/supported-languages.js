/**
 * Supported Languages — single source of truth
 *
 * The canonical list of language codes the platform accepts, plus their
 * display names. Historically this list was duplicated across
 * language-cache.js, language-detector.service.js, the WhatsApp language
 * picker, and a DB CHECK constraint, which drifted out of sync. This module
 * consolidates the *code list + display names*; provider-specific routing
 * (Soniox hints, TTS voice IDs) still lives with each provider's config but
 * validates codes against SUPPORTED_LANGUAGES.
 *
 * Support notes:
 * - Full support (conversation + reading assessment): en, ur
 * - Conversation only (coaching/chat/LP/quiz/voice): every other code
 * - Reading-assessment norms (WCPM/LCPM) exist only for en/ur today; the
 *   Indian languages are conversation-only at launch (see the India language
 *   expansion plan).
 *
 * Tamil disambiguation: `ta-LK` is Sri Lankan Tamil (pre-existing); `ta-IN`
 * is Indian Tamil. Both normalize to Soniox `ta` via `.split('-')[0]`.
 */

// Ordered map: code -> display names. Order is used as the default picker order.
const LANGUAGES = {
  // Full support
  en: { native: 'English', english: 'English' },
  ur: { native: 'اردو', english: 'Urdu' },

  // Pakistan regional (conversation only)
  'pa-PK': { native: 'پنجابی', english: 'Punjabi' },
  'sd-PK': { native: 'سنڌي', english: 'Sindhi' },
  'ps-PK': { native: 'پښتو', english: 'Pashto' },
  'bal-PK': { native: 'بلوچی', english: 'Balochi' },
  'ta-LK': { native: 'தமிழ்', english: 'Tamil (Sri Lanka)' },

  // India (conversation only)
  hi: { native: 'हिन्दी', english: 'Hindi' },
  bn: { native: 'বাংলা', english: 'Bengali' },
  mr: { native: 'मराठी', english: 'Marathi' },
  te: { native: 'తెలుగు', english: 'Telugu' },
  'ta-IN': { native: 'தமிழ்', english: 'Tamil' },
  kn: { native: 'ಕನ್ನಡ', english: 'Kannada' },

  // East Africa (conversation only)
  sw: { native: 'Kiswahili', english: 'Kiswahili' },

  // Other
  ar: { native: 'العربية', english: 'Arabic' },
  es: { native: 'Español', english: 'Spanish' },
  fr: { native: 'Français', english: 'French' },
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES);
const DEFAULT_LANGUAGE = 'en';

// Codes whose scripts are right-to-left (Perso-Arabic). Indian (Brahmic)
// scripts are LTR, so they are intentionally excluded.
const RTL_LANGUAGES = ['ur', 'ar', 'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK'];

/**
 * @param {string} code
 * @returns {boolean} whether the code is a supported language
 */
function isSupported(code) {
  return typeof code === 'string' && SUPPORTED_LANGUAGES.includes(code);
}

/**
 * ALLOWED_LANGUAGES (comma-separated codes) narrows a deployment to the languages its teachers use. Unset, or with no
 * recognisable code in it, every language stays available: a typo must not lock teachers out.
 * @returns {string[]} the codes this deployment may use, in the order given
 */
function allowedLanguages(env = process.env) {
  const listed = String(env.ALLOWED_LANGUAGES || '').split(',').map((c) => c.trim()).filter(isSupported);
  return listed.length > 0 ? listed : SUPPORTED_LANGUAGES;
}

function isRestricted(env = process.env) {
  return allowedLanguages(env) !== SUPPORTED_LANGUAGES;
}

function isAllowed(code, env = process.env) {
  return allowedLanguages(env).includes(code);
}

/** The code if this deployment uses it, otherwise the default. Unrestricted, any value passes through untouched. */
function restrictLanguage(code, env = process.env) {
  if (!isRestricted(env)) return code;
  return isAllowed(code, env) ? code : DEFAULT_LANGUAGE;
}

/** What a language menu should offer: its own list, or the deployment's when that is narrowed. */
function offeredLanguages(codes, env = process.env) {
  return isRestricted(env) ? allowedLanguages(env) : codes;
}

/**
 * Human-readable label for a code, e.g. "हिन्दी (Hindi)".
 * Falls back to the raw code for unknown values.
 * @param {string} code
 * @returns {string}
 */
function getLabel(code) {
  const entry = LANGUAGES[code];
  if (!entry) return code;
  return entry.native === entry.english
    ? entry.native
    : `${entry.native} (${entry.english})`;
}

/**
 * English name for a code (used in logs / LLM prompts).
 * @param {string} code
 * @returns {string}
 */
function getEnglishName(code) {
  return LANGUAGES[code]?.english || code;
}

/**
 * Build a WhatsApp/settings dropdown ({id,title}) from a list of codes,
 * skipping unknown codes. Order follows the input array.
 * @param {string[]} codes
 * @returns {{id: string, title: string}[]}
 */
function toDropdown(codes) {
  return (Array.isArray(codes) ? codes : [])
    .filter((c) => LANGUAGES[c])
    .map((c) => ({ id: c, title: getLabel(c) }));
}

/**
 * @param {string} code
 * @returns {boolean} whether the code's script is right-to-left
 */
function isRTL(code) {
  return RTL_LANGUAGES.includes(code);
}

module.exports = {
  LANGUAGES,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  RTL_LANGUAGES,
  isSupported,
  allowedLanguages,
  isRestricted,
  isAllowed,
  restrictLanguage,
  offeredLanguages,
  getLabel,
  getEnglishName,
  toDropdown,
  isRTL,
};
