/**
 * Reflective-question language layer (principle-driven, future-proof).
 *
 * The reflective-question prompt body carries the cross-lingual PRINCIPLES that never change:
 *   • write in the teacher's everyday staff-room register (not bookish/classical/foreign-borrowed)
 *   • never require the teacher's gender — agree with a noun, not the addressee
 *   • keep subject terms (multiply, place value, proper nouns) in English/Latin for clean TTS
 *
 * This module carries only the thin per-language DATA those principles need: the language name,
 * its script, the region whose spoken register to match, and two short hints (what to avoid, how
 * gender works). Adding a new language is ONE entry here — zero change to prompt logic.
 *
 * Soniox already transcribes ur / sw / en / ar, so the profile is keyed by the same ISO codes the
 * transcriber emits. `ar` ships as a working stub ahead of the Arabic rollout.
 *
 * An unknown / null code must never crash question generation — `resolveProfile` returns a
 * principle-only fallback that still instructs gender-neutrality, so a brand-new transcriber
 * language degrades to "principles only" rather than an exception.
 */

const LANGUAGE_PROFILES = {
  ur: {
    language: 'Urdu',
    script: 'Nastaliq',
    region: 'Pakistan',
    avoid_hint: " Avoid Hindi-isms ('turant'→'foran') and bookish words (taajub, muntakhab, markooz).",
    gender_hint:
      "Urdu is gendered — agree verbs with a noun (zehen, khayal, sawal, qadam), not with 'aap'.",
    time_phrase_examples: "'shuru mein'/'kareeb 10 minute par'/'lesson ke aakhir mein'",
  },
  sw: {
    language: 'Kiswahili',
    script: 'Latin',
    region: 'Tanzania',
    avoid_hint: '',
    gender_hint: 'Kiswahili is gender-neutral — write naturally.',
    time_phrase_examples: "'mwanzoni'/'karibu dakika 10'/'mwishoni mwa somo'",
  },
  en: {
    language: 'English',
    script: 'Latin',
    region: '(English-medium)',
    avoid_hint: ' Write entirely in English: no Urdu, Hindi, Kiswahili or other words in any script, even if the lesson used them. The only exception is a word actually spoken in the lesson, quoted verbatim in single quotes.',
    gender_hint: 'English 2nd-person is gender-neutral — write naturally.',
    time_phrase_examples: "'at the start'/'about 10 minutes in'/'near the end of the lesson'",
  },
  ar: {
    language: 'Arabic',
    script: 'Arabic',
    region: '(Arabic-speaking)',
    avoid_hint: ' Avoid classical/Quranic register; use simple spoken MSA.',
    gender_hint:
      "Arabic is gendered: undiacritized PAST-tense reads as neutral, but FUTURE/imperfect is NOT — restructure to a noun ('ما هي الخطوة الأولى' not 'ماذا ستفعل').",
  },
};

/**
 * Resolve a transcript/preference language code to a profile.
 * Resolution order at the call site: coaching_sessions.transcript_language →
 * users.preferred_language → region default → 'en'. This fn just maps a final code → profile,
 * with a principle-only fallback for any code we don't ship yet.
 *
 * @param {string|null|undefined} code  ISO language code (e.g. 'ur', 'sw').
 * @returns {{language:string, script:string, region:string, avoid_hint:string, gender_hint:string}}
 */
function resolveProfile(code) {
  if (code && LANGUAGE_PROFILES[code]) return LANGUAGE_PROFILES[code];
  return {
    language: code || 'English',
    script: 'Latin',
    region: '',
    avoid_hint: '',
    gender_hint: 'Use a gender-neutral construction native to this language.',
  };
}

module.exports = { LANGUAGE_PROFILES, resolveProfile };
