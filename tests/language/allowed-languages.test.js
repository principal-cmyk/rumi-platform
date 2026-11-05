'use strict';
/**
 * ALLOWED_LANGUAGES narrows a deployment to the languages its teachers use. A school in Tanzania wants English and
 * Kiswahili; nothing should offer, detect or store another language there. Unset, nothing changes.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockRedis = { get: jest.fn(async () => null), set: jest.fn(async () => true) };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
const mockUpdate = jest.fn(() => ({ eq: async () => ({ error: null }) }));
const mockStored = { language: 'ur' };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { preferred_language: mockStored.language }, error: null }) }) }),
    update: mockUpdate,
  }),
}));

const langs = require('../../bot/shared/config/supported-languages');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ALLOWED_LANGUAGES = 'en,sw';
});
afterEach(() => { delete process.env.ALLOWED_LANGUAGES; });

describe('the setting', () => {
  test('narrows the list and keeps the order given', () => {
    expect(langs.allowedLanguages()).toEqual(['en', 'sw']);
  });

  test('Kiswahili is a real language with a name', () => {
    expect(langs.isSupported('sw')).toBe(true);
    expect(langs.getEnglishName('sw')).toBe('Kiswahili');
  });

  test('unset, every language stays available', () => {
    delete process.env.ALLOWED_LANGUAGES;
    expect(langs.allowedLanguages()).toEqual(langs.SUPPORTED_LANGUAGES);
    expect(langs.restrictLanguage('ur')).toBe('ur');
  });

  test('a list of nonsense does not lock everyone out', () => {
    process.env.ALLOWED_LANGUAGES = 'klingon';
    expect(langs.allowedLanguages()).toEqual(langs.SUPPORTED_LANGUAGES);
  });

  test('anything outside the list becomes the default', () => {
    expect(langs.restrictLanguage('ur')).toBe('en');
    expect(langs.restrictLanguage('sw')).toBe('sw');
  });

  test('a menu offers exactly the allowed languages, including ones its own list lacked', () => {
    expect(langs.offeredLanguages(['en', 'ur', 'ar'])).toEqual(['en', 'sw']);
  });

  test('unset, a menu keeps its own list', () => {
    delete process.env.ALLOWED_LANGUAGES;
    expect(langs.offeredLanguages(['en', 'ur', 'ar'])).toEqual(['en', 'ur', 'ar']);
  });
});

describe('a teacher language preference', () => {
  const { getUserLanguage, setUserLanguage } = require('../../bot/shared/utils/language-cache');

  test('cannot be set outside the list', async () => {
    await expect(setUserLanguage('u1', 'ur')).resolves.toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('can be set to Kiswahili', async () => {
    await expect(setUserLanguage('u1', 'sw')).resolves.toBe(true);
  });

  test('a stored language outside the list reads as the default', async () => {
    mockStored.language = 'ur';
    await expect(getUserLanguage('u1')).resolves.toBe('en');
  });

  test('a cached language outside the list is ignored', async () => {
    mockRedis.get.mockResolvedValueOnce('ur');
    mockStored.language = 'sw';
    await expect(getUserLanguage('u1')).resolves.toBe('sw');
  });
});

describe('asking for a language', () => {
  const { detectLanguageOverride, LANGUAGE_OVERRIDE_COMMANDS } = require('../../bot/shared/utils/language-detector');

  test('a command for a language outside the list is ignored', () => {
    const urdu = Object.keys(LANGUAGE_OVERRIDE_COMMANDS).find((c) => c === 'ur');
    if (!urdu) return;
    const anyPattern = LANGUAGE_OVERRIDE_COMMANDS.ur[0];
    jest.spyOn(anyPattern, 'test').mockReturnValue(true);
    expect(detectLanguageOverride('anything')).toBeNull();
    anyPattern.test.mockRestore();
  });
});

describe('automatic detection', () => {
  const Detector = require('../../bot/shared/services/language-detector.service');

  test('Urdu script does not switch the conversation out of the list', () => {
    expect(Detector.detectLanguage('آپ کیسے ہیں میں ٹھیک ہوں')).toBe('en');
  });

  test('unset, it still detects as before', () => {
    delete process.env.ALLOWED_LANGUAGES;
    expect(Detector.detectLanguage('आप कैसे हैं')).toBe('hi');
  });
});
