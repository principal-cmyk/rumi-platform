'use strict';
/** Which videos are lessons, how many stills are sampled, and how visual evidence reaches the scoring prompt. */
const config = require('../../../bot/shared/config/coaching-video');

const KEYS = ['COACHING_VIDEO_MIN_SECONDS', 'COACHING_VIDEO_MAX_SECONDS', 'COACHING_VIDEO_MAX_BYTES', 'COACHING_VIDEO_FRAME_COUNT'];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe('isCoachingVideoLength', () => {
  test.each([[599, false], [600, true], [750, true], [900, true], [901, false], [0, false], [null, false]])(
    'default range: %p seconds → %p', (seconds, expected) => {
      expect(config.isCoachingVideoLength(seconds)).toBe(expected);
    },
  );

  test('a fraction of a second over the line still counts: phones never stop on the exact second', () => {
    expect(config.isCoachingVideoLength(900.4)).toBe(true);
    expect(config.isCoachingVideoLength(599.6)).toBe(true);
  });

  test('the range follows the environment', () => {
    process.env.COACHING_VIDEO_MIN_SECONDS = '300';
    process.env.COACHING_VIDEO_MAX_SECONDS = '1200';
    expect(config.isCoachingVideoLength(300)).toBe(true);
    expect(config.isCoachingVideoLength(1200)).toBe(true);
  });

  test('a nonsense range falls back to the default rather than refusing every video', () => {
    process.env.COACHING_VIDEO_MIN_SECONDS = '2000';
    process.env.COACHING_VIDEO_MAX_SECONDS = '100';
    expect(config.videoLengthRange()).toEqual({ min: 600, max: 900 });
  });
});

describe('videoFrameCount', () => {
  test('defaults to 6 and is clamped, because each still costs a vision call', () => {
    expect(config.videoFrameCount()).toBe(6);
    process.env.COACHING_VIDEO_FRAME_COUNT = '500';
    expect(config.videoFrameCount()).toBe(12);
    process.env.COACHING_VIDEO_FRAME_COUNT = '0';
    expect(config.videoFrameCount()).toBe(0);
  });
});

describe('appendVisualEvidence', () => {
  test('without notes the prompt is byte-identical: audio coaching must not change', () => {
    expect(config.appendVisualEvidence('PROMPT', null)).toBe('PROMPT');
    expect(config.appendVisualEvidence('PROMPT', '')).toBe('PROMPT');
  });

  test('notes are added, and framed as stills rather than a record of the whole lesson', () => {
    const out = config.appendVisualEvidence('PROMPT', '[02:00] Pupils in rows.');
    expect(out).toContain('PROMPT');
    expect(out).toContain('[02:00] Pupils in rows.');
    expect(out).toMatch(/still frames/i);
  });

  test('a framework that already placed the notes is not given them twice', () => {
    const prompt = 'PHOTOS:\n[02:00] Pupils in rows.';
    expect(config.appendVisualEvidence(prompt, '[02:00] Pupils in rows.')).toBe(prompt);
  });
});
