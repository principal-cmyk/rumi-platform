'use strict';
/**
 * The worker's half of a recording: it must use the stored copy (the only copy on the linked-device channel), keep a
 * video marked as video, feed its stills in, skip the photo question a video has already answered, and delete the
 * recording when it is done. Classroom audio must behave as it did.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
const mockSession = {};
const mockUpdates = [];
jest.mock('../../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: mockSession, error: null }),
        not: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
      }),
    }),
    update: (row) => { mockUpdates.push(row); return { eq: async () => ({}) }; },
  }),
}));
const mockWhatsApp = {
  downloadMedia: jest.fn(), sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
};
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../../bot/shared/storage/r2', () => ({ isR2Configured: () => false, uploadClassroomAudio: jest.fn() }));
const mockSessionService = { updateStatus: jest.fn(async () => ({})), updateConversationState: jest.fn(async () => ({})) };
jest.mock('../../../bot/shared/services/coaching/coaching-session.service', () => mockSessionService);
const mockStore = { load: jest.fn(), remove: jest.fn() };
jest.mock('../../../bot/shared/services/coaching/coaching-media-store', () => mockStore);
const mockIntake = { prepare: jest.fn(), observeFrames: jest.fn() };
jest.mock('../../../bot/shared/services/coaching/video-intake.service', () => mockIntake);
const mockLp = { advanceToLessonPlanStep: jest.fn(async () => true) };
jest.mock('../../../bot/shared/services/coaching/lp-coaching/lp-step.service', () => mockLp);
jest.mock('../../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  generateEncouragingMessage: jest.fn(async () => 'Well done'),
}));
jest.mock('../../../bot/shared/services/coaching/classroom-photo/photo-prompt.service', () => ({
  buildPhotoPrompt: jest.fn(() => ({ body: 'photo?' })),
}));
jest.mock('../../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'), setUserLanguage: jest.fn(async () => true),
}));
jest.mock('../../../bot/shared/services/audio.service', () => ({}));

const Processor = require('../../../bot/shared/services/coaching/transcription-processor.service');

const frames = [{ buffer: Buffer.from('f'), atSeconds: 100 }];
const row = (over = {}) => Object.assign(mockSession, {
  id: 'cs1', user_id: 'u1', audio_duration_seconds: 720, audio_format: null, observation_type: null,
  users: { phone_number: '255700000000', first_name: 'Asha' }, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates.length = 0;
  jest.spyOn(Processor, 'sendProgressUpdate').mockResolvedValue();
  jest.spyOn(Processor, 'transcribeWithDiarization').mockResolvedValue({
    transcript: 'Good morning class', language: 'en', tokens: [], silences: [], diarization: { speakers: [], confidence: 1 },
  });
});

const run = () => Processor.processTranscription('cs1', { from: '255700000000', audioId: 'm1' });
const savedFormat = () => mockUpdates.find((u) => 'audio_format' in u).audio_format;

describe('a lesson video', () => {
  beforeEach(() => {
    row({ audio_format: 'video' });
    mockStore.load.mockReturnValue({ audio: Buffer.from('a'), frames });
    mockIntake.observeFrames.mockResolvedValue({ evidence: '[01:40] Pupils in groups.', stats: { readable: 1 } });
  });

  test('uses the stored copy, because the worker cannot fetch it from the channel', async () => {
    await run();
    expect(mockWhatsApp.downloadMedia).not.toHaveBeenCalled();
  });

  test('stays marked as a video and carries its visual notes to scoring', async () => {
    await run();
    expect(savedFormat()).toBe('video');
    expect(mockIntake.observeFrames).toHaveBeenCalledWith(frames);
    expect(mockSessionService.updateConversationState).toHaveBeenCalledWith('cs1', {
      video_observations: '[01:40] Pupils in groups.', video_observation_stats: { readable: 1 },
    });
  });

  test('goes straight to the lesson-plan step: the video already showed the classroom', async () => {
    await run();
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(mockLp.advanceToLessonPlanStep).toHaveBeenCalledWith({ sessionId: 'cs1', from: '255700000000' });
  });

  test('deletes the stored recording once it is done', async () => {
    await run();
    expect(mockStore.remove).toHaveBeenCalledWith('m1');
  });

  test('a vision outage still reaches the lesson-plan step', async () => {
    mockIntake.observeFrames.mockResolvedValue({ evidence: null, stats: null });
    await run();
    expect(mockLp.advanceToLessonPlanStep).toHaveBeenCalled();
  });

  test('with no shared disk the worker fetches the video and prepares it itself', async () => {
    mockStore.load.mockReturnValue(null);
    mockWhatsApp.downloadMedia.mockResolvedValue(Buffer.from('video'));
    mockIntake.prepare.mockResolvedValue({ seconds: 720, audio: Buffer.from('a'), frames });
    await run();
    expect(mockIntake.prepare).toHaveBeenCalledWith(Buffer.from('video'));
  });

  test('a failed transcription keeps the recording, so a retry has something to read', async () => {
    Processor.transcribeWithDiarization.mockRejectedValue(new Error('stt down'));
    jest.spyOn(Processor, 'handleTranscriptionError').mockResolvedValue();
    await expect(run()).rejects.toThrow('stt down');
    expect(mockStore.remove).not.toHaveBeenCalled();
  });
});

describe('classroom audio', () => {
  beforeEach(() => row());

  test('with no stored copy it still comes from the channel, and is not treated as a video', async () => {
    mockStore.load.mockReturnValue(null);
    mockWhatsApp.downloadMedia.mockResolvedValue(Buffer.from('audio'));
    await run();
    expect(mockIntake.prepare).not.toHaveBeenCalled();
    expect(savedFormat()).toBe('ogg');
  });

  test('a stored copy is used on the linked-device channel, then deleted', async () => {
    mockStore.load.mockReturnValue({ audio: Buffer.from('a'), frames: [] });
    await run();
    expect(mockWhatsApp.downloadMedia).not.toHaveBeenCalled();
    expect(mockStore.remove).toHaveBeenCalledWith('m1');
  });

  test('still gets the classroom-photo question', async () => {
    mockStore.load.mockReturnValue({ audio: Buffer.from('a'), frames: [] });
    await run();
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalled();
    expect(mockLp.advanceToLessonPlanStep).not.toHaveBeenCalled();
  });
});
