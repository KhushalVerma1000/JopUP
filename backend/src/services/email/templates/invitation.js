const ROLE_LABELS = { org_admin: 'Organisation Admin', manager: 'Manager', hr: 'HR' };

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Link the invitee clicks. The frontend must serve this route (see PATCH notes). */
function buildAcceptUrl(token) {
  const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
}

function invitationEmail({ orgName, inviterName, roleName, teamName, token, expiresAt }) {
  const url = buildAcceptUrl(token);
  const role = ROLE_LABELS[roleName] || roleName;
  const expires = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const who = inviterName ? esc(inviterName) : 'An administrator';
  const teamLine = teamName ? ` in the <strong>${esc(teamName)}</strong> team` : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">
    <tr><td>
      <h2 style="margin:0 0 16px;font-size:20px">You're invited to join ${esc(orgName)}</h2>
      <p style="margin:0 0 16px;line-height:1.5">${who} invited you to join <strong>${esc(orgName)}</strong> on JopUP as <strong>${esc(role)}</strong>${teamLine}.</p>
      <p style="margin:24px 0"><a href="${esc(url)}" style="background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Accept invitation</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#52525b">This link expires on ${esc(expires)}. If the button doesn't work, paste this into your browser:</p>
      <p style="margin:0 0 16px;font-size:13px;word-break:break-all;color:#52525b">${esc(url)}</p>
      <p style="margin:0;font-size:12px;color:#71717a">If you weren't expecting this, you can ignore this email.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject: `You're invited to join ${orgName} on JopUP`, html };
}

module.exports = { invitationEmail, buildAcceptUrl };
