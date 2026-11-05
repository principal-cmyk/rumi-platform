'use strict';
/**
 * On the linked-device channel a recording lives only in the bot's memory, for ten minutes, and transcription runs in
 * the worker: a separate process. This store is the bridge. It holds classroom recordings, so it must also clean up.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let dir;
let store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-store-'));
  process.env.CHANNEL_STATE_DIR = dir;
  store = require('../../../bot/shared/services/coaching/coaching-media-store');
});
afterEach(() => {
  delete process.env.CHANNEL_STATE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('what one process saves another can load, frames in order', () => {
  store.save('MEDIA/1', {
    audio: Buffer.from('audio'),
    frames: [{ buffer: Buffer.from('a'), atSeconds: 60 }, { buffer: Buffer.from('b'), atSeconds: 120 }],
  });
  jest.resetModules();
  const other = require('../../../bot/shared/services/coaching/coaching-media-store');
  const loaded = other.load('MEDIA/1');
  expect(loaded.audio.toString()).toBe('audio');
  expect(loaded.frames.map((f) => [f.buffer.toString(), f.atSeconds])).toEqual([['a', 60], ['b', 120]]);
});

test('a media id cannot steer the path out of the store', () => {
  store.save('../../escape', { audio: Buffer.from('x'), frames: [] });
  expect(fs.existsSync(path.join(dir, '..', 'escape'))).toBe(false);
  expect(store.load('../../escape').audio.toString()).toBe('x');
});

test('an unknown id loads as null, so the caller falls back to the channel', () => {
  expect(store.load('nope')).toBeNull();
});

test('only the owner can read a recording', () => {
  store.save('m', { audio: Buffer.from('x'), frames: [] });
  const entry = path.join(dir, 'coaching-media', fs.readdirSync(path.join(dir, 'coaching-media'))[0]);
  expect(fs.statSync(entry).mode & 0o077).toBe(0);
});

test('remove deletes the recording and never throws', () => {
  store.save('m', { audio: Buffer.from('x'), frames: [] });
  store.remove('m');
  expect(store.load('m')).toBeNull();
  expect(() => store.remove('m')).not.toThrow();
});

test('sweep deletes abandoned recordings and keeps recent ones', () => {
  store.save('old', { audio: Buffer.from('x'), frames: [] });
  store.save('new', { audio: Buffer.from('y'), frames: [] });
  const root = path.join(dir, 'coaching-media');
  const [oldDir] = fs.readdirSync(root).filter((d) => d === store.entryName('old'));
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(root, oldDir), past, past);
  store.sweep();
  expect(store.load('old')).toBeNull();
  expect(store.load('new')).not.toBeNull();
});
