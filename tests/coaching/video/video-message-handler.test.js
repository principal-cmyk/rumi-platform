'use strict';
/** What a teacher's video does: the right length starts coaching, anything else gets a plain explanation. */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockWhatsApp = { sendMessage: jest.fn(async () => true), downloadMedia: jest.fn(async () => Buffer.from('video')) };
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
const mockCoaching = { initiateCoachingSession: jest.fn(async () => ({ id: 'cs1' })) };
jest.mock('../../../bot/shared/services/coaching-orchestrator.service', () => mockCoaching);
const mockHelpers = { getOrCreateSession: jest.fn(async () => 'chat1') };
jest.mock('../../../bot/shared/database/bot-helpers', () => mockHelpers);
const mockIntake = { prepare: jest.fn() };
jest.mock('../../../bot/shared/services/coaching/video-intake.service', () => mockIntake);
const mockStore = { save: jest.fn(), remove: jest.fn(), sweep: jest.fn() };
jest.mock('../../../bot/shared/services/coaching/coaching-media-store', () => mockStore);

const { handleVideoMessage } = require('../../../bot/shared/handlers/video-message.handler');

const user = { id: 'u1' };
const video = (over = {}) => ({ video: { id: 'v1', mime_type: 'video/mp4', duration: 720, ...over } });
const prepared = { seconds: 720, audio: Buffer.from('a'), frames: [] };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SONIOX_API_KEY = 'key';
  mockIntake.prepare.mockResolvedValue(prepared);
  mockCoaching.initiateCoachingSession.mockResolvedValue({ id: 'cs1' });
});
afterEach(() => { delete process.env.SONIOX_API_KEY; delete process.env.OPENAI_API_KEY; });

const lastReply = () => mockWhatsApp.sendMessage.mock.calls.at(-1)[1];

test('a 12-minute video is prepared, stored for the worker and starts a coaching session marked as video', async () => {
  await handleVideoMessage(video(), '255700000000', user);
  expect(mockStore.save).toHaveBeenCalledWith('v1', prepared);
  expect(mockCoaching.initiateCoachingSession).toHaveBeenCalledWith('u1', 'chat1', 'v1', '255700000000', 720, { mediaKind: 'video' });
});

test.each([[300], [1200]])('a %i-second video is explained, not downloaded', async (duration) => {
  await handleVideoMessage(video({ duration }), '255700000000', user);
  expect(mockWhatsApp.downloadMedia).not.toHaveBeenCalled();
  expect(mockCoaching.initiateCoachingSession).not.toHaveBeenCalled();
  expect(lastReply()).toMatch(/10.*15 minutes/);
});

test('a file with no reported length is measured after download, and refused if out of range', async () => {
  mockIntake.prepare.mockResolvedValue({ ...prepared, seconds: 200 });
  await handleVideoMessage(video({ duration: undefined }), '255700000000', user);
  expect(mockIntake.prepare).toHaveBeenCalled();
  expect(mockStore.save).not.toHaveBeenCalled();
  expect(lastReply()).toMatch(/10.*15 minutes/);
});

test('a file over the size limit is refused before it costs a download', async () => {
  await handleVideoMessage(video({ file_size: 5 * 1024 * 1024 * 1024 }), '255700000000', user);
  expect(mockWhatsApp.downloadMedia).not.toHaveBeenCalled();
  expect(lastReply()).toMatch(/too large/i);
});

test('without speech-to-text the teacher is told, rather than left waiting on a job that must fail', async () => {
  delete process.env.SONIOX_API_KEY;
  await handleVideoMessage(video(), '255700000000', user);
  expect(mockWhatsApp.downloadMedia).not.toHaveBeenCalled();
  expect(lastReply()).toMatch(/not switched on/i);
});

test('a video with no sound track gets a specific explanation', async () => {
  mockIntake.prepare.mockRejectedValue(Object.assign(new Error('no audio'), { code: 'NO_AUDIO' }));
  await handleVideoMessage(video(), '255700000000', user);
  expect(lastReply()).toMatch(/no sound/i);
  expect(mockCoaching.initiateCoachingSession).not.toHaveBeenCalled();
});

test('when the daily allowance refuses the session, the recording is not left on disk', async () => {
  mockCoaching.initiateCoachingSession.mockResolvedValue(null);
  await handleVideoMessage(video(), '255700000000', user);
  expect(mockStore.remove).toHaveBeenCalledWith('v1');
});

test('an unexpected failure is reported and the recording is cleaned up', async () => {
  mockCoaching.initiateCoachingSession.mockRejectedValue(new Error('db down'));
  await handleVideoMessage(video(), '255700000000', user);
  expect(mockStore.remove).toHaveBeenCalledWith('v1');
  expect(lastReply()).toMatch(/sorry/i);
});

test('a media-less message from an unregistered sender is asked to register', async () => {
  await handleVideoMessage(video(), '255700000000', null);
  expect(lastReply()).toMatch(/register/i);
});
