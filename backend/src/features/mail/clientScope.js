const { BadRequestError } = require('../../utils/errors');

/**
 * A mail to a client may only ever contain that client's candidates.
 *
 * When the caller names the client (clientId: a uuid, or null for internal
 * hires) every tracker must belong to it. A tracker from anyone else is a
 * refusal, not a quiet drop: the list HR was looking at is not the list that
 * would have been mailed, and they need to know before it goes out.
 * When no client is named (the older copy-only flow) mail is still built one
 * client at a time — see MailService._lineup.
 */
function assertSingleClient(trackers, clientId) {
  if (clientId === undefined) return trackers;
  const outsiders = trackers.filter((t) => (t.clientId || null) !== clientId);
  if (outsiders.length) {
    const n = outsiders.length;
    throw new BadRequestError(`${n} selected ${n === 1 ? 'candidate belongs' : 'candidates belong'} to a different client. A client mail can only list that client's own candidates.`);
  }
  return trackers;
}

module.exports = { assertSingleClient };
