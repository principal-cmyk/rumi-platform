/**
 * Hands a classroom recording from the bot to the worker.
 *
 * The linked-device channel has no fetch-by-id: a recording exists only in the bot process's memory, for ten minutes.
 * Transcription runs later, in the worker, which is a separate process, so downloadMedia() there can never find it.
 * This store keeps what coaching needs on disk under CHANNEL_STATE_DIR, keyed by media id, until the job is done.
 *
 * Deployments where the bot and worker do not share a disk simply miss here and fetch from the channel, which works
 * on Meta. These files are recordings of children: readable by the owner only, deleted when transcription finishes,
 * and swept after a day if a teacher never confirms.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../utils/logger');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUDIO_FILE = 'audio.ogg';
const FRAME_RE = /^frame-(\d+)-(\d+)\.jpg$/;

function rootDir() {
  const root = process.env.CHANNEL_STATE_DIR || '.channel-state';
  return path.join(path.isAbsolute(root) ? root : path.resolve(REPO_ROOT, root), 'coaching-media');
}

/** Hashed: a media id comes from outside, and must not be able to steer a path. */
function entryName(mediaId) {
  return crypto.createHash('sha256').update(String(mediaId)).digest('hex');
}

function entryDir(mediaId) {
  return path.join(rootDir(), entryName(mediaId));
}

function save(mediaId, { audio, frames = [] }) {
  const dir = entryDir(mediaId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(dir, AUDIO_FILE), audio, { mode: 0o600 });
  frames.forEach((frame, index) => {
    fs.writeFileSync(path.join(dir, `frame-${index}-${Math.round(frame.atSeconds)}.jpg`), frame.buffer, { mode: 0o600 });
  });
}

/**
 * Classroom audio on the linked-device channel: without this the worker cannot reach the recording at all, because
 * the bot's memory is the only place it exists. Never throws: the voice-note path around it must keep working.
 */
function stashAudioForWorker(mediaId, audio) {
  if (process.env.CHANNEL_DRIVER !== 'baileys' || !audio) return;
  try {
    sweep();
    save(mediaId, { audio });
  } catch (error) {
    logToFile('⚠️ Could not store a classroom recording for the worker', { error: error.message });
  }
}

function load(mediaId) {
  const dir = entryDir(mediaId);
  const audioPath = path.join(dir, AUDIO_FILE);
  if (!fs.existsSync(audioPath)) return null;
  const frames = fs.readdirSync(dir)
    .map((name) => ({ name, match: FRAME_RE.exec(name) }))
    .filter((f) => f.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((f) => ({ buffer: fs.readFileSync(path.join(dir, f.name)), atSeconds: Number(f.match[2]) }));
  return { audio: fs.readFileSync(audioPath), frames };
}

function remove(mediaId) {
  try {
    fs.rmSync(entryDir(mediaId), { recursive: true, force: true });
  } catch (error) {
    logToFile('⚠️ Could not remove a stored classroom recording', { error: error.message });
  }
}

/** Removes recordings nobody finished with. Never throws: cleanup must not cost a teacher their session. */
function sweep(maxAgeMs = MAX_AGE_MS) {
  try {
    const root = rootDir();
    if (!fs.existsSync(root)) return;
    const cutoff = Date.now() - maxAgeMs;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (error) {
    logToFile('⚠️ Classroom recording sweep failed', { error: error.message });
  }
}

module.exports = { save, stashAudioForWorker, load, remove, sweep, entryName };
