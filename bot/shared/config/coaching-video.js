/**
 * Which videos are classroom lessons, and how a video's visual evidence reaches the scoring prompt.
 *
 * Video coaching takes COACHING_VIDEO_MIN_SECONDS to COACHING_VIDEO_MAX_SECONDS (default 10 to 15 minutes, inclusive).
 * Lengths are rounded before comparing: a phone never stops recording on the exact second.
 */
const DEFAULT_MIN_SECONDS = 600;
const DEFAULT_MAX_SECONDS = 900;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB: the bot holds the file in memory while it extracts the audio
const DEFAULT_FRAME_COUNT = 6;
const MAX_FRAME_COUNT = 12; // each still is one vision call

function positiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function videoLengthRange() {
  const min = positiveInt(process.env.COACHING_VIDEO_MIN_SECONDS) || DEFAULT_MIN_SECONDS;
  const max = positiveInt(process.env.COACHING_VIDEO_MAX_SECONDS) || DEFAULT_MAX_SECONDS;
  return min < max ? { min, max } : { min: DEFAULT_MIN_SECONDS, max: DEFAULT_MAX_SECONDS };
}

function isCoachingVideoLength(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return false;
  const rounded = Math.round(n);
  const { min, max } = videoLengthRange();
  return rounded >= min && rounded <= max;
}

function maxVideoBytes() {
  return positiveInt(process.env.COACHING_VIDEO_MAX_BYTES) || DEFAULT_MAX_BYTES;
}

/** 0 is allowed: it turns visual analysis off and leaves speech-based coaching. */
function videoFrameCount() {
  const raw = process.env.COACHING_VIDEO_FRAME_COUNT;
  if (raw === undefined || raw === '') return DEFAULT_FRAME_COUNT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FRAME_COUNT;
  return Math.min(n, MAX_FRAME_COUNT);
}

/** Speech-to-text is the one thing a video cannot be coached without. */
function isVideoCoachingAvailable(env = process.env) {
  return !!(env.SONIOX_API_KEY || env.OPENAI_API_KEY);
}

/**
 * Adds the stills' notes to a scoring prompt. Every framework and the default inline prompt end up here, so a video
 * is scored on what was seen whichever rubric is active. No notes returns the prompt untouched, which keeps audio
 * coaching byte-identical. A framework that already placed the notes (mewaka) is not given them twice.
 */
function appendVisualEvidence(prompt, notes) {
  if (!notes || prompt.includes(notes)) return prompt;
  return `${prompt}

VISUAL EVIDENCE FROM THE LESSON VIDEO
These are descriptions of still frames sampled across the lesson, each marked with its time. Use them only for what
can be seen, such as classroom layout, displays, materials, how pupils are grouped and where the teacher stands. They
are moments, not a record of the lesson: do not infer what happened between them, and let the transcript decide
anything about what was said or taught.
${notes}`;
}

module.exports = {
  videoLengthRange,
  isCoachingVideoLength,
  maxVideoBytes,
  videoFrameCount,
  isVideoCoachingAvailable,
  appendVisualEvidence,
};
