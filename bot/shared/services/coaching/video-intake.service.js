/**
 * Turns a lesson video into what coaching consumes: its sound as an audio track, and stills spread across the lesson.
 * The video itself is not kept. A failure describing the stills only costs the visual notes: the teacher still gets
 * coaching from the speech.
 *
 * The stills do not use the classroom-photo prompts. Those tell the model it is looking at a classroom, and the
 * default system prompt asks it to encourage: given a colour test pattern, that combination described pupils in rows
 * and a teacher at a whiteboard. Invented evidence in a teacher's feedback is worse than none, so here the model
 * answers a fixed checklist at temperature 0, and can always say it cannot tell (see video-observation.js).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { logToFile } = require('../../utils/logger');
const { privateTempPath, removePrivateTemp } = require('../../utils/private-temp');
const { TEMP_DIR } = require('../../utils/constants');
const { videoFrameCount } = require('../../config/coaching-video');

const run = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const FRAME_WIDTH = 1280; // hands at the back of a room need the pixels

const ffmpegPath = () => require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = () => require('@ffprobe-installer/ffprobe').path;

/** n evenly spaced moments, never the very start or end, where a phone is being set down or picked up. */
function frameTimestamps(seconds, n) {
  if (!n || !seconds) return [];
  const step = seconds / (n + 1);
  return Array.from({ length: n }, (_, i) => Math.round(step * (i + 1)));
}

async function probe(videoPath) {
  const { stdout } = await run(ffprobePath(), [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', videoPath,
  ], { timeout: FFMPEG_TIMEOUT_MS });
  const info = JSON.parse(stdout);
  return {
    seconds: Number(info.format && info.format.duration) || 0,
    hasAudio: (info.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

async function extractAudio(videoPath, outputPath) {
  // Mono 16 kHz is what the speech-to-text step converts to anyway; the rest of a classroom video is size, not signal.
  await run(ffmpegPath(), [
    '-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k', outputPath,
  ], { timeout: FFMPEG_TIMEOUT_MS });
}

async function extractFrame(videoPath, atSeconds, outputPath) {
  await run(ffmpegPath(), [
    '-y', '-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1', '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`,
    '-q:v', '4', outputPath,
  ], { timeout: FFMPEG_TIMEOUT_MS });
}

/**
 * @param {Buffer} videoBuffer
 * @returns {Promise<{seconds:number, audio:Buffer, frames:Array<{buffer:Buffer, atSeconds:number}>}>}
 * @throws an error with code NO_AUDIO when the video has no sound track
 */
async function prepare(videoBuffer) {
  const temp = privateTempPath(TEMP_DIR, 'lesson-video', 'lesson-video-');
  try {
    await fs.promises.writeFile(temp.filePath, videoBuffer);
    const { seconds, hasAudio } = await probe(temp.filePath);
    if (!hasAudio) throw Object.assign(new Error('Video has no audio track'), { code: 'NO_AUDIO' });

    const audioPath = path.join(temp.dir, 'audio.ogg');
    await extractAudio(temp.filePath, audioPath);

    const frames = [];
    for (const [index, atSeconds] of frameTimestamps(seconds, videoFrameCount(seconds)).entries()) {
      const framePath = path.join(temp.dir, `frame-${index}.jpg`);
      try {
        await extractFrame(temp.filePath, atSeconds, framePath);
        frames.push({ buffer: await fs.promises.readFile(framePath), atSeconds });
      } catch (error) {
        logToFile('⚠️ Could not extract a video still', { atSeconds, error: error.message });
      }
    }

    return { seconds, audio: await fs.promises.readFile(audioPath), frames };
  } finally {
    removePrivateTemp(temp);
  }
}

/**
 * Reads each still against the checklist, then counts across the lesson.
 * Sequential: thirty images at once is how a shared vision quota gets exhausted.
 * @returns {Promise<{evidence: string|null, stats: object|null}>}
 */
async function observeFrames(frames) {
  if (!frames || frames.length === 0) return { evidence: null, stats: null };
  const { analyzeWithRetry } = require('../vision.service');
  const {
    FRAME_PROMPT, FRAME_SYSTEM_PROMPT, parseFrameObservation, summarise, evidenceText,
  } = require('./video-observation');

  const observations = [];
  for (const frame of frames) {
    try {
      const result = await analyzeWithRetry(frame.buffer, 'image/jpeg', {
        prompt: FRAME_PROMPT, systemPrompt: FRAME_SYSTEM_PROMPT, temperature: 0, detail: 'high',
      });
      const observation = result.success ? parseFrameObservation(result.analysis, frame.atSeconds) : null;
      if (observation) observations.push(observation);
    } catch (error) {
      logToFile('⚠️ Video still could not be read', { atSeconds: frame.atSeconds, error: error.message });
    }
  }
  if (observations.length === 0) return { evidence: null, stats: null };
  return { evidence: evidenceText(observations, frames.length), stats: summarise(observations, frames.length) };
}

module.exports = { prepare, frameTimestamps, observeFrames };
