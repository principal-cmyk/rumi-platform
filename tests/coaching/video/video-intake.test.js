'use strict';
/** Turning a lesson video into coaching inputs: one audio track, and stills spread across the lesson. */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@ffmpeg-installer/ffmpeg', () => ({ path: '/fake/ffmpeg' }), { virtual: true });
jest.mock('@ffprobe-installer/ffprobe', () => ({ path: '/fake/ffprobe' }), { virtual: true });

const mockAnalyze = jest.fn();
jest.mock('../../../bot/shared/services/vision.service', () => ({
  analyzeWithRetry: (...args) => mockAnalyze(...args),
}));
const seen = (analysis) => ({ success: true, analysis });

const { frameTimestamps, describeFrames } = require('../../../bot/shared/services/coaching/video-intake.service');

beforeEach(() => mockAnalyze.mockReset());

describe('frameTimestamps', () => {
  test('spreads stills evenly and stays off the very start and end', () => {
    expect(frameTimestamps(700, 6)).toEqual([100, 200, 300, 400, 500, 600]);
  });

  test('no stills asked for, none taken', () => {
    expect(frameTimestamps(700, 0)).toEqual([]);
  });
});

describe('describeFrames', () => {
  const frames = [
    { buffer: Buffer.from('a'), atSeconds: 125 },
    { buffer: Buffer.from('b'), atSeconds: 250 },
  ];

  test('notes are time-stamped so the scorer can line them up with the lesson', async () => {
    mockAnalyze.mockResolvedValueOnce(seen('Pupils in rows.')).mockResolvedValueOnce(seen('Teacher at the board.'));
    await expect(describeFrames(frames)).resolves.toBe('[02:05] Pupils in rows.\n[04:10] Teacher at the board.');
  });

  test('one unreadable still does not lose the others', async () => {
    mockAnalyze.mockResolvedValueOnce({ success: false, error: 'bad image' }).mockResolvedValueOnce(seen('Teacher at the board.'));
    await expect(describeFrames(frames)).resolves.toBe('[04:10] Teacher at the board.');
  });

  test.each([['NOT_VISIBLE'], ['NOT_VISIBLE.'], ['  NOT_VISIBLE\n']])(
    'a still the model cannot read (%j) never becomes evidence', async (reply) => {
      mockAnalyze.mockResolvedValue(seen(reply));
      await expect(describeFrames(frames)).resolves.toBeNull();
    },
  );

  test('the model is told not to assume a classroom, may refuse, and is not asked to be creative or encouraging', async () => {
    mockAnalyze.mockResolvedValue(seen('Pupils in rows.'));
    await describeFrames(frames);
    const options = mockAnalyze.mock.calls[0][2];
    expect(options.prompt).toMatch(/do not assume/i);
    expect(options.prompt).toContain('NOT_VISIBLE');
    expect(options.temperature).toBe(0);
    expect(options.systemPrompt).toMatch(/never guess/i);
  });

  test('a vision outage leaves null: the teacher still gets speech-based coaching', async () => {
    mockAnalyze.mockRejectedValue(new Error('vision down'));
    await expect(describeFrames(frames)).resolves.toBeNull();
  });

  test('no frames makes no vision calls', async () => {
    await expect(describeFrames([])).resolves.toBeNull();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });
});
