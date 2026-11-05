/**
 * Where the background worker runs.
 *
 * A linked WhatsApp device allows one process on the session, enforced by the instance lock in baileys-connection.js,
 * and the worker delivers coaching reports, lesson plans and every other background result. As a separate process it
 * could never send. So on that channel the worker runs inside the bot, sharing its connection. The Cloud API has no
 * such limit, and production keeps the worker separate so the two can scale apart.
 */
const { resolveChannelDriver } = require('../../config/feature-availability');

function workerRunsInsideBot(env = process.env) {
  return resolveChannelDriver(env) === 'baileys';
}

module.exports = { workerRunsInsideBot };
