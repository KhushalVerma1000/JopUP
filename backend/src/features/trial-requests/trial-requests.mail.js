/**
 * Emails around plan requests. Pure builders (no sending) so they can be tested.
 * Every user-typed value is HTML-escaped: the request form is public.
 */
const PLAN_LABEL = { enterprise: 'Enterprise trial', pro: 'Pro upgrade' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** To the sales inbox. Reply-To is the requester, so "Reply" answers them. */
function salesMail(r) {
  const label = PLAN_LABEL[r.requestedPlan] || r.requestedPlan;
  const rows = [
    ['Request', label], ['Name', r.name], ['Email', r.email], ['Company', r.company],
    ['Phone', r.phone], ['Team size', r.teamSize], ['Message', r.message],
  ].filter(([, v]) => v);
  const html = `<p><strong>New ${esc(label)} request</strong></p>
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<p style="color:#666">Approve it in Platform &rarr; Trials &amp; requests.</p>`;
  return { subject: `${label} request: ${r.company}`.slice(0, 150), html, replyTo: r.email };
}

/** To the requester, once the request is saved. Makes no promise about timing. */
function acknowledgement(r) {
  const label = r.requestedPlan === 'pro' ? 'Pro upgrade' : 'Enterprise trial';
  return {
    subject: `We got your ${label} request`,
    html: `<p>Hi ${esc(r.name.split(' ')[0])},</p>
<p>Thanks for asking about HireTracker ${esc(label.replace(' trial', '').replace(' upgrade', ''))}. We received your request for ${esc(r.company)} and will reply to this email address.</p>
<p>Your free trial keeps running in the meantime.</p>`,
  };
}

/** To the requester when an Enterprise trial is switched on. */
function approvedMail(r, endsAt) {
  const when = new Date(endsAt).toISOString().slice(0, 10);
  return {
    subject: 'Your HireTracker Enterprise trial is active',
    html: `<p>Hi ${esc(r.name.split(' ')[0])},</p>
<p>Your Enterprise trial for ${esc(r.company)} is now on, until ${esc(when)}. Sign in as usual and the Enterprise features are there.</p>`,
  };
}

module.exports = { esc, salesMail, acknowledgement, approvedMail, PLAN_LABEL };
