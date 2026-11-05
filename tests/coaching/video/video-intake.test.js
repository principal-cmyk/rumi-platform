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

const { frameTimestamps, observeFrames } = require('../../../bot/shared/services/coaching/video-intake.service');

beforeEach(() => mockAnalyze.mockReset());

describe('frameTimestamps', () => {
  test('spreads stills evenly and stays off the very start and end', () => {
    expect(frameTimestamps(700, 6)).toEqual([100, 200, 300, 400, 500, 600]);
  });

  test('no stills asked for, none taken', () => {
    expect(frameTimestamps(700, 0)).toEqual([]);
  });
});

describe('observeFrames', () => {
  const frames = [
    { buffer: Buffer.from('a'), atSeconds: 125 },
    { buffer: Buffer.from('b'), atSeconds: 250 },
  ];
  const checklist = (over = {}) => seen(JSON.stringify({
    classroom_visible: true,
    students: { order: 'calm', hands_raised: 'few', off_task: 'none', activity: 'listening', note: 'Pupils in rows.' },
    teacher: { position: 'front', interaction: 'whole_class', leaning_in: 'no', note: '' },
    ...over,
  }));

  test('produces time-stamped evidence and counts', async () => {
    mockAnalyze.mockResolvedValue(checklist());
    const result = await observeFrames(frames);
    expect(result.evidence).toContain('[02:05]');
    expect(result.stats.readable).toBe(2);
  });

  test('one unreadable still does not lose the others, and is counted as unread', async () => {
    mockAnalyze.mockResolvedValueOnce({ success: false, error: 'bad image' }).mockResolvedValueOnce(checklist());
    const result = await observeFrames(frames);
    expect(result.stats.readable).toBe(1);
    expect(result.stats.total).toBe(2);
  });

  test('a still with no classroom in it never becomes evidence', async () => {
    mockAnalyze.mockResolvedValue(seen(JSON.stringify({ classroom_visible: false })));
    await expect(observeFrames(frames)).resolves.toEqual({ evidence: null, stats: null });
  });

  test('a vision outage leaves nothing: the teacher still gets speech-based coaching', async () => {
    mockAnalyze.mockRejectedValue(new Error('vision down'));
    await expect(observeFrames(frames)).resolves.toEqual({ evidence: null, stats: null });
  });

  test('no frames makes no vision calls', async () => {
    await expect(observeFrames([])).resolves.toEqual({ evidence: null, stats: null });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  test('the model may answer unclear, must not assume a classroom, and sees the detail hands need', async () => {
    mockAnalyze.mockResolvedValue(checklist());
    await observeFrames(frames);
    const options = mockAnalyze.mock.calls[0][2];
    expect(options.prompt).toMatch(/do not assume/i);
    expect(options.prompt).toContain('unclear');
    expect(options.prompt).toContain('classroom_visible');
    expect(options.temperature).toBe(0);
    expect(options.detail).toBe('high');
    expect(options.systemPrompt).toMatch(/never guess/i);
  });
});
