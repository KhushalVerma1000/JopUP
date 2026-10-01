# Patch: platform email via Resend (invitations)

## Files (complete final versions)
- backend/src/services/email/index.js              NEW  sendEmail() entry point + provider selection
- backend/src/services/email/providers/resend.js   NEW  Resend REST (fetch, no new dependency)
- backend/src/services/email/providers/console.js  NEW  dev/test provider (logs only)
- backend/src/services/email/templates/invitation.js NEW  HTML invitation email
- backend/src/features/invitations/invitations.service.js    sends email after create; token hidden in production
- backend/src/features/invitations/invitations.controller.js reports emailSent
- backend/test/email.test.js                       NEW  6 tests, no DB needed
- backend/.env.example                             appended email vars (existing lines untouched)
- frontend/src/pages/ManagerialPage.jsx            copy updated, shows warning if emailSent=false

## Setup
1. Resend: add + verify a domain (e.g. mail.yourdomain.com), create an API key.
2. In backend env (docker-compose.yml `environment:` or .env):
     RESEND_API_KEY=re_...
     EMAIL_FROM=JopUP <no-reply@mail.yourdomain.com>
     APP_URL=http://localhost:5173
   Without RESEND_API_KEY it falls back to the console provider (logs the email).
3. Resend's sandbox sender onboarding@resend.dev only delivers to your own Resend account email.

## Known gap
The email links to  {APP_URL}/accept-invite?token=...  but the frontend has no such page yet
(only POST /api/v1/invitations/accept exists). Next patch: AcceptInvitePage + route.
