/**
 * A video from a teacher. One of lesson length starts classroom coaching; anything else gets a plain explanation.
 * Called for WhatsApp videos and for videos sent as a file, which arrive without a reported length.
 */
const WhatsAppService = require('../services/whatsapp.service');
const CoachingService = require('../services/coaching-orchestrator.service');
const VideoIntake = require('../services/coaching/video-intake.service');
const CoachingMediaStore = require('../services/coaching/coaching-media-store');
const { getOrCreateSession } = require('../database/bot-helpers');
const { logToFile } = require('../utils/logger');
const {
  videoLengthRange, isCoachingVideoLength, maxVideoBytes, isVideoCoachingAvailable,
} = require('../config/coaching-video');

function lengthMessage() {
  const { min, max } = videoLengthRange();
  return `I can give coaching feedback on classroom videos between ${Math.round(min / 60)} and ${Math.round(max / 60)} minutes long. `
    + 'Please send a recording of that length.';
}

async function handleVideoMessage(message, from, user = null) {
  const videoId = message.video && message.video.id;
  const reportedSeconds = Number(message.video && message.video.duration) || 0;
  const fileSize = Number(message.video && message.video.file_size) || 0;
  logToFile('🎥 Video received', { videoId, reportedSeconds, fileSize });

  if (!user) {
    await WhatsAppService.sendMessage(from, 'Please complete your registration first before using classroom coaching. Type /register to get started.');
    return;
  }
  if (!isVideoCoachingAvailable()) {
    await WhatsAppService.sendMessage(from, 'Classroom video feedback is not switched on yet. Please ask your administrator to add a speech-to-text key.');
    return;
  }
  if (fileSize > maxVideoBytes()) {
    await WhatsAppService.sendMessage(from, 'That video is too large for me to process. Please record at a lower quality and send it again.');
    return;
  }
  if (reportedSeconds > 0 && !isCoachingVideoLength(reportedSeconds)) {
    await WhatsAppService.sendMessage(from, lengthMessage());
    return;
  }

  CoachingMediaStore.sweep();

  try {
    await WhatsAppService.sendMessage(from, '🎥 Got your video. Preparing it now, this can take a minute.');
    const buffer = await WhatsAppService.downloadMedia(videoId);
    const prepared = await VideoIntake.prepare(buffer);

    if (!isCoachingVideoLength(prepared.seconds)) {
      await WhatsAppService.sendMessage(from, lengthMessage());
      return;
    }

    CoachingMediaStore.save(videoId, prepared);
    const sessionId = await getOrCreateSession(user.id);
    const coachingSession = await CoachingService.initiateCoachingSession(
      user.id, sessionId, videoId, from, Math.round(prepared.seconds), { mediaKind: 'video' },
    );
    if (!coachingSession) CoachingMediaStore.remove(videoId); // refused by the daily allowance
  } catch (error) {
    logToFile('❌ Video coaching intake failed', { videoId, error: error.message, code: error.code });
    CoachingMediaStore.remove(videoId);
    await WhatsAppService.sendMessage(from, error.code === 'NO_AUDIO'
      ? 'That video has no sound, and I need to hear the lesson to give feedback. Please check the microphone and record again.'
      : 'Sorry, I could not process that video. Please try sending it again.');
  }
}

module.exports = { handleVideoMessage };
