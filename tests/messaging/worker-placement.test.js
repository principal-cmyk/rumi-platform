'use strict';
/**
 * A linked WhatsApp device allows one process on the session, and the worker delivers coaching reports, lesson plans
 * and every other background result. As a separate process it could never send: each attempt failed on the instance
 * lock and the teacher heard nothing. So on that channel the worker runs inside the bot.
 */
const fs = require('fs');
const path = require('path');

const { workerRunsInsideBot } = require('../../bot/shared/services/messaging/worker-placement');

const workerSource = fs.readFileSync(path.join(__dirname, '../../bot/workers/sqs-worker.js'), 'utf8');
const botSource = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');

describe('workerRunsInsideBot', () => {
  test('a linked device shares one process', () => {
    expect(workerRunsInsideBot({ CHANNEL_DRIVER: 'baileys' })).toBe(true);
  });

  test('the Cloud API keeps its separate worker: production scales them apart', () => {
    expect(workerRunsInsideBot({ CHANNEL_DRIVER: 'meta' })).toBe(false);
  });
});

describe('loaded inside the bot, the worker must not act as if it owned the process', () => {
  const gate = workerSource.indexOf('const RUNS_ALONE = require.main === module;');

  test.each([["process.on('SIGTERM'"], ["process.on('SIGINT'"], ["process.on('uncaughtException'"]])(
    '%s stays behind the standalone gate: exiting here would cut off the WhatsApp key flush', (needle) => {
      const at = workerSource.indexOf(needle);
      expect(gate).toBeGreaterThan(-1);
      expect(workerSource.lastIndexOf('if (RUNS_ALONE) {', at)).toBeGreaterThan(gate);
    },
  );

  test('it does not take relay mode, which belongs to a process that does not own a connection', () => {
    expect(workerSource).toMatch(/if \(RUNS_ALONE\) require\('\.\.\/shared\/services\/messaging\/matrix-outbound-relay'\)\.useRelayForThisProcess\(\)/);
  });

  test('started on its own on a linked device it refuses, rather than failing every send', () => {
    const main = workerSource.slice(workerSource.lastIndexOf('if (require.main === module) {'));
    expect(main.indexOf('workerRunsInsideBot()')).toBeGreaterThan(-1);
    expect(main.indexOf('workerRunsInsideBot()')).toBeLessThan(main.indexOf('startWorker()'));
  });
});

test('the bot stops the worker before it closes the channel', () => {
  const shutdown = botSource.slice(botSource.indexOf('const shutdown = async (signal)'));
  expect(shutdown.indexOf('stopEmbeddedWorker()')).toBeGreaterThan(-1);
  expect(shutdown.indexOf('stopEmbeddedWorker()')).toBeLessThan(shutdown.indexOf('driver.close()'));
});
