'use strict';
/** The point of the stills: their notes must reach the model, whichever rubric is active. */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/config/supabase', () => ({}));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
const mockCreate = jest.fn();
jest.mock('../../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));

const GPT5 = require('../../../bot/shared/services/gpt5-mini.service');

const NOTES = '[02:00] Pupils sit in pairs.';
const sentPrompt = () => mockCreate.mock.calls[0][0].messages[1].content;

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockRejectedValue(new Error('stop here: only the prompt is under test'));
  GPT5.openai = { chat: { completions: { create: mockCreate } } };
});

const moduleFramework = (over = {}) => ({
  name: 'hots', getSystemPrompt: () => 'SYSTEM', buildAnalysisPrompt: () => 'MODULE PROMPT', computeScores: () => ({}), ...over,
});

test('the default rubric sees the notes', async () => {
  await GPT5.analyzePedagogy('transcript', { visualEvidence: NOTES }).catch(() => {});
  expect(sentPrompt()).toContain(NOTES);
});

test('a framework module sees the notes, including one that ignores its photo argument', async () => {
  await GPT5.analyzePedagogy('transcript', { visualEvidence: NOTES }, null, moduleFramework()).catch(() => {});
  expect(sentPrompt()).toContain('MODULE PROMPT');
  expect(sentPrompt()).toContain(NOTES);
});

test('a framework that handles photos itself is handed them, once', async () => {
  const buildAnalysisPrompt = jest.fn((t, m, l, photos) => `PHOTOS: ${photos}`);
  await GPT5.analyzePedagogy('transcript', { visualEvidence: NOTES }, null, moduleFramework({ buildAnalysisPrompt })).catch(() => {});
  expect(buildAnalysisPrompt.mock.calls[0][3]).toBe(NOTES);
  expect(sentPrompt().split(NOTES)).toHaveLength(2);
});

test('an audio session sends exactly the prompt it always did', async () => {
  await GPT5.analyzePedagogy('transcript', {}, null, moduleFramework()).catch(() => {});
  expect(sentPrompt()).toBe('MODULE PROMPT');
});
