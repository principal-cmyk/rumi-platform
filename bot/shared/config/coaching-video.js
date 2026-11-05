/**
 * Which videos are classroom lessons, and how a video's visual evidence reaches the scoring prompt.
 *
 * Video coaching takes COACHING_VIDEO_MIN_SECONDS to COACHING_VIDEO_MAX_SECONDS (default 10 to 15 minutes, inclusive).
 * Lengths are rounded before comparing: a phone never stops recording on the exact second.
 */
const DEFAULT_MIN_SECONDS = 600;
const DEFAULT_MAX_SECONDS = 900;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB: the bot holds the file in memory while it extracts the audio
const DEFAULT_FRAME_INTERVAL_SECONDS = 30; // often enough for patterns across a lesson to show
const MAX_FRAME_COUNT = 30; // each still is one vision call

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

/** How many stills to read from a video this long. An interval of 0 turns visual analysis off. */
function videoFrameCount(seconds) {
  const raw = process.env.COACHING_VIDEO_FRAME_INTERVAL_SECONDS;
  const parsed = raw === undefined || raw === '' ? NaN : Math.floor(Number(raw));
  const interval = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FRAME_INTERVAL_SECONDS;
  if (interval === 0) return 0;
  return Math.min(Math.round(seconds / interval), MAX_FRAME_COUNT);
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
These come from still frames sampled about every 30 seconds, read against a fixed checklist, with counts worked out
across the lesson. Times match the transcript's timestamps. Use them as evidence of behaviour alongside the transcript:
- Students: whether basic order was kept, raising of hands, and how many were off task.
- Teacher: circulation around the room, leaning in to conversations with students, and redirecting off task learners.
  To judge redirection, line up the moments students were off task with what the teacher said in the transcript around
  that time and where the teacher was standing.
Refer to specific moments and counts where they matter, and let them shape your strengths and growth areas. Say
"in the sampled moments", because stills can miss what happens between them. Absence from a still is not proof
something never happened. "unclear" and "not_visible" mean the camera could not tell, so say nothing about those.
The transcript decides anything about what was said or taught.
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
