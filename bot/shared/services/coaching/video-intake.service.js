/**
 * Turns a lesson video into what coaching consumes: its sound as an audio track, and stills spread across the lesson.
 * The video itself is not kept. A failure describing the stills only costs the visual notes: the teacher still gets
 * coaching from the speech.
 *
 * The stills do not use the classroom-photo prompts. Those tell the model it is looking at a classroom, and the
 * default system prompt asks it to encourage: given a colour test pattern, that combination described pupils in rows
 * and a teacher at a whiteboard. Invented evidence in a teacher's feedback is worse than none, so here the model is
 * told to report only what is visible, at temperature 0, and must be able to answer that it cannot see a classroom.
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
const FRAME_WIDTH = 1024;
const NOT_VISIBLE = 'NOT_VISIBLE';
const FRAME_SYSTEM_PROMPT = 'You describe images factually for a classroom observation record. You never guess, '
  + 'assume or invent details, and you do not praise or judge.';
const FRAME_PROMPT = `This is one still from a phone video. It may or may not show a classroom, so do not assume it does.

If you cannot clearly see a real classroom, with people or learning materials, reply with exactly ${NOT_VISIBLE}. That includes an image that is dark, blurred or blocked, a screen, a test pattern, or anything else.

Otherwise, in 2-3 neutral sentences, state only what is visible: how the room and pupils are arranged, where the teacher is, and any displays, boards or materials. Do not guess at anything out of frame, do not describe what people might be thinking, and do not identify anyone.`;

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
    for (const [index, atSeconds] of frameTimestamps(seconds, videoFrameCount()).entries()) {
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

function clock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Time-stamped notes on what the stills show, or null if none could be read.
 * Sequential: a dozen images at once is how a shared vision quota gets exhausted.
 */
async function describeFrames(frames) {
  if (!frames || frames.length === 0) return null;
  const { analyzeWithRetry } = require('../vision.service');
  const notes = [];
  for (const frame of frames) {
    try {
      const result = await analyzeWithRetry(frame.buffer, 'image/jpeg', {
        prompt: FRAME_PROMPT, systemPrompt: FRAME_SYSTEM_PROMPT, temperature: 0, detail: 'low',
      });
      const note = result.success && result.analysis ? result.analysis.trim() : '';
      if (note && !note.includes(NOT_VISIBLE)) notes.push(`[${clock(frame.atSeconds)}] ${note}`);
    } catch (error) {
      logToFile('⚠️ Video still could not be described', { atSeconds: frame.atSeconds, error: error.message });
    }
  }
  return notes.length > 0 ? notes.join('\n') : null;
}

module.exports = { prepare, frameTimestamps, describeFrames };
