'use strict';
/** Coaching transcription hints: Kiswahili was missing, and a Tanzanian deployment must not be steered toward others. */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('fluent-ffmpeg', () => { const f = jest.fn(); f.setFfmpegPath = jest.fn(); f.setFfprobePath = jest.fn(); return f; }, { virtual: true });
jest.mock('@ffmpeg-installer/ffmpeg', () => ({ path: 'x' }), { virtual: true });
jest.mock('@ffprobe-installer/ffprobe', () => ({ path: 'x' }), { virtual: true });

const AudioService = require('../../bot/shared/services/audio.service');

afterEach(() => { delete process.env.ALLOWED_LANGUAGES; });

test('Kiswahili is hinted', () => {
  expect(AudioService.SONIOX_AUTODETECT_HINTS).toContain('sw');
  expect(AudioService.SONIOX_LANGUAGES).toContain('sw');
});

test('a narrowed deployment hints only its own languages', () => {
  process.env.ALLOWED_LANGUAGES = 'en,sw';
  expect(AudioService.autodetectHints()).toEqual(['en', 'sw']);
});

test('unset, every hint stays', () => {
  expect(AudioService.autodetectHints()).toEqual(AudioService.SONIOX_AUTODETECT_HINTS);
});
