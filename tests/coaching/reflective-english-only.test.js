'use strict';
/**
 * A teacher set to English was asked "Kareeb 7-8 minute par, aapne poochha...". The corpus prompt offered only Urdu and
 * Kiswahili example phrases, and English had no script gate to catch the drift, so Roman Urdu reached the teacher.
 */
const { buildCorpusPrompt } = require('../../bot/shared/services/coaching/reflective-questions/corpus-prompt');
const { buildQuestionPrompt } = require('../../bot/shared/services/coaching/reflective-questions/question-prompt');
const { resolveProfile } = require('../../bot/shared/services/coaching/reflective-questions/language-profiles');
const { validateQuestion } = require('../../bot/shared/services/coaching/reflective-questions/guardrails');

const en = resolveProfile('en');
const LIVE_QUESTION = "Kareeb 7-8 minute par, aapne poochha 'The answer is C?' aur students ne '40', '44', '4' jaise answers diye. "
  + "Aapne sawaal ko dohraaya lekin 'C' kya hai, yeh nahi samjhaaya.";

describe('the prompts for an English teacher', () => {
  test('offer English time phrases and no Urdu or Kiswahili to copy', () => {
    const prompt = buildCorpusPrompt(en);
    expect(prompt).toContain('about 10 minutes in');
    expect(prompt).not.toMatch(/kareeb|shuru mein|mwanzoni|karibu dakika/);
  });

  test.each([['corpus', () => buildCorpusPrompt(en)], ['question', () => buildQuestionPrompt(1, {}, en, 'Asha')]])(
    'the %s prompt rules out other languages', (_, build) => {
      expect(build()).toMatch(/entirely in English/i);
    },
  );

  test.each([['corpus', () => buildCorpusPrompt(en)], ['question', () => buildQuestionPrompt(1, {}, en, 'Asha')]])(
    'the %s prompt never says "English (Latin)", which a model took as the Latin language', (_, build) => {
      expect(build()).not.toMatch(/English \(Latin\)|in Latin/);
    },
  );

  test('Urdu keeps its script in the prompt', () => {
    expect(buildQuestionPrompt(1, {}, resolveProfile('ur'), 'Asha')).toContain('Urdu (Nastaliq)');
  });

  test('Urdu and Kiswahili keep their own examples', () => {
    expect(buildCorpusPrompt(resolveProfile('ur'))).toContain('kareeb 10 minute par');
    expect(buildCorpusPrompt(resolveProfile('sw'))).toContain('karibu dakika 10');
  });
});

describe("the teacher's name", () => {
  test('an unknown name stays unknown: a sample name in the prompt was being used on real teachers', () => {
    const prompt = buildQuestionPrompt(1, {}, en, '');
    expect(prompt).not.toContain('Afshan');
    expect(prompt).toMatch(/do not know her name/);
  });

  test('a known name is used', () => {
    expect(buildQuestionPrompt(1, {}, en, 'Asha')).toContain('"Asha"');
  });
});

describe('the guardrail for an English teacher', () => {
  test('rejects the exact question that reached a teacher', () => {
    expect(validateQuestion(LIVE_QUESTION, {}, '', en)).toContain('wrong_language');
  });

  test('rejects Roman Kiswahili too', () => {
    expect(validateQuestion('Katika somo hili, wanafunzi walifanya nini wakati ulipouliza swali?', {}, '', en)).toContain('wrong_language');
  });

  test('rejects a language nobody listed: a model read "English (Latin)" and wrote actual Latin', () => {
    const q = "Incipiente lectione, cum diceres 'remove 1', discipuli '6' et '5' clamabant. Quid tum in animo agebas cum his clamoribus occurreres?";
    expect(validateQuestion(q, {}, '', en)).toContain('wrong_language');
  });

  test('passes real English', () => {
    const q = "About seven minutes in, you asked 'The answer is C?' and students said '40', '44' and '4'. What was going through your mind then?";
    expect(validateQuestion(q, {}, '', en)).toEqual([]);
  });

  test('a verbatim quote may be in another language: teachers really do say these words', () => {
    const q = "Near the end you said 'kya samajh aaya, bachon?' and the class went quiet. What did you notice then?";
    expect(validateQuestion(q, {}, '', en)).toEqual([]);
  });

  test('other languages are not held to the English gate', () => {
    expect(validateQuestion('Katika somo hili, wanafunzi walifanya nini wakati ulipouliza swali?', {}, '', resolveProfile('sw'))).toEqual([]);
  });
});
