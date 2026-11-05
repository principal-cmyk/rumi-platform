'use strict';
/**
 * Voice is optional, but the first reflection question had no fallback: without a working speech key the whole coaching
 * session failed after scoring had already succeeded, and the teacher was told the analysis had a problem.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
const mockState = { questions: [] };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: { analysis_data: {}, conversation_state: mockState, transcript_text: 't', user_id: 'u1' }, error: null,
        }),
      }),
    }),
  }),
}));
const mockWhatsApp = { sendAudio: jest.fn(async () => true), sendMessage: jest.fn(async () => true) };
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
const mockSpeech = { generateSpeechForLanguage: jest.fn() };
jest.mock('../../bot/shared/services/elevenlabs.service', () => mockSpeech);
const mockSession = { updateConversationState: jest.fn(async () => ({})), updateStatus: jest.fn(async () => ({})) };
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => mockSession);
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'), setUserLanguage: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/coaching/reflective-questions/guardrails', () => ({
  buildSafeFallback: () => 'What went well today?',
}));
jest.mock('../../bot/shared/services/coaching/reflective-questions/language-profiles', () => ({ resolveProfile: () => ({}) }));

const Reflective = require('../../bot/shared/services/coaching/reflective-conversation.service');

beforeEach(() => jest.clearAllMocks());

test('with a working voice the question is spoken', async () => {
  mockSpeech.generateSpeechForLanguage.mockResolvedValue(Buffer.from('audio'));
  await Reflective.conductReflectiveConversation('cs1', '255700000000');
  expect(mockWhatsApp.sendAudio).toHaveBeenCalled();
  expect(mockWhatsApp.sendMessage).not.toHaveBeenCalled();
});

test('with no voice available the question is typed, and the conversation carries on', async () => {
  mockSpeech.generateSpeechForLanguage.mockRejectedValue(new Error('OPENAI_API_KEY is required'));
  await expect(Reflective.conductReflectiveConversation('cs1', '255700000000')).resolves.toBeUndefined();
  expect(mockWhatsApp.sendMessage).toHaveBeenCalledWith('255700000000', 'What went well today?');
  expect(mockSession.updateStatus).toHaveBeenCalledWith('cs1', 'conducting_conversation');
});
