'use strict';
/** Which videos are lessons, how many stills are sampled, and how visual evidence reaches the scoring prompt. */
const config = require('../../../bot/shared/config/coaching-video');

const KEYS = ['COACHING_VIDEO_MIN_SECONDS', 'COACHING_VIDEO_MAX_SECONDS', 'COACHING_VIDEO_MAX_BYTES', 'COACHING_VIDEO_FRAME_INTERVAL_SECONDS'];
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
  test('samples every 30 seconds, so patterns across the lesson can show', () => {
    expect(config.videoFrameCount(480)).toBe(16);
    expect(config.videoFrameCount(900)).toBe(30);
  });

  test('is capped, because each still is a vision call', () => {
    expect(config.videoFrameCount(3600)).toBe(30);
    process.env.COACHING_VIDEO_FRAME_INTERVAL_SECONDS = '1';
    expect(config.videoFrameCount(900)).toBe(30);
  });

  test('the interval can be widened', () => {
    process.env.COACHING_VIDEO_FRAME_INTERVAL_SECONDS = '60';
    expect(config.videoFrameCount(900)).toBe(15);
  });

  test('0 turns visual analysis off', () => {
    process.env.COACHING_VIDEO_FRAME_INTERVAL_SECONDS = '0';
    expect(config.videoFrameCount(900)).toBe(0);
  });
});

describe('appendVisualEvidence', () => {
  test('without notes the prompt is byte-identical: audio coaching must not change', () => {
    expect(config.appendVisualEvidence('PROMPT', null)).toBe('PROMPT');
    expect(config.appendVisualEvidence('PROMPT', '')).toBe('PROMPT');
  });

  test('asks the scorer to weigh behaviour, and to line stills up with what was said', () => {
    const out = config.appendVisualEvidence('PROMPT', '[02:00] Pupils in rows.');
    expect(out).toMatch(/circulat/i);
    expect(out).toMatch(/redirect/i);
    expect(out).toMatch(/off task/i);
    expect(out).toMatch(/transcript/i);
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
