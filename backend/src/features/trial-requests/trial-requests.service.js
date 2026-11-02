const { sql } = require('drizzle-orm');
const { db, schema } = require('../../utils/db');
const { eq, and, gt, desc } = require('drizzle-orm');
const { sendEmail } = require('../../services/email');
const mail = require('./trial-requests.mail');

const PLATFORM_ORG_SLUG = process.env.PLATFORM_ORG_SLUG || 'jopup-platform';
const DUPLICATE_WINDOW_DAYS = 30;
const rows = (result) => result.rows ?? result;

/** Sales inbox(es): TRIAL_REQUEST_TO="a@x.com,b@x.com". Unset = saved but not emailed. */
function salesRecipients() {
  return String(process.env.TRIAL_REQUEST_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Never throws: a mail problem must not lose or fail a saved request. */
async function trySend(msg) {
  try { await sendEmail(msg); return true; } catch (err) {
    console.warn(`[plan-request] email not sent: ${err.message}`);
    return false;
  }
}

/** Workspaces (not the platform org) that have a user with this email. */
async function workspacesForEmails(emails) {
  if (!emails.length) return new Map();
  const list = rows(await db.execute(sql`
    SELECT DISTINCT lower(u.email) AS email, o.id, o.name, o.status
    FROM "user" u JOIN organisation o ON o.id = u.organisation_id
    WHERE lower(u.email) IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)}) AND o.slug <> ${PLATFORM_ORG_SLUG}`));
  const map = new Map();
  for (const r of list) {
    if (!map.has(r.email)) map.set(r.email, []);
    map.get(r.email).push({ id: r.id, name: r.name, status: r.status });
  }
  return map;
}

class TrialRequestsService {
  /** Public. Saves the request, then emails sales and the requester. */
  async create(data) {
    // Honeypot: a bot filled the hidden field. Say thanks, store nothing.
    if (data.website) return { received: true };

    const email = data.email.trim().toLowerCase();
    const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 86400000);
    const [existing] = await db.select({ id: schema.trialRequest.id }).from(schema.trialRequest).where(and(
      eq(schema.trialRequest.email, email),
      eq(schema.trialRequest.requestedPlan, data.plan),
      eq(schema.trialRequest.status, 'pending'),
      gt(schema.trialRequest.createdAt, since),
    ));
    if (existing) return { received: true, duplicate: true };

    const match = (await workspacesForEmails([email])).get(email) || [];
    const [row] = await db.insert(schema.trialRequest).values({
      requestedPlan: data.plan, name: data.name, email, company: data.company,
      phone: data.phone || null, teamSize: data.teamSize || null, message: data.message || null,
      organisationId: match.length === 1 ? match[0].id : null,
    }).returning();

    const to = salesRecipients();
    if (to.length) await trySend({ to, ...mail.salesMail(row) });
    else console.warn('[plan-request] TRIAL_REQUEST_TO is not set: request saved, sales not emailed');
    await trySend({ to: email, ...mail.acknowledgement(row) });

    return { received: true };
  }
}

module.exports = new TrialRequestsService();
module.exports.workspacesForEmails = workspacesForEmails;
module.exports.trySend = trySend;
