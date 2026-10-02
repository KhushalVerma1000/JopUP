# Patch: accept-invite flow

Fixes the broken invited-user journey. The emailed link `{APP_URL}/accept-invite?token=...`
had no frontend route and fell through to /login with the token dropped.

## Frontend
- NEW  frontend/src/pages/AcceptInvitePage.jsx  - reads ?token, asks name/phone/password, calls accept, lands on role home
- MOD  frontend/src/context/AuthContext.jsx     - adds acceptInvite() (stores session from the JWT the backend returns)
- MOD  frontend/src/App.jsx                     - adds /accept-invite route

## Backend
- NEW  backend/src/utils/checkEnv.js            - production requires a non-localhost APP_URL
- MOD  backend/server.js                        - runs the check at boot (NODE_ENV=production only)
- MOD  backend/.env.example                     - documents APP_URL as required in production
- NEW  backend/test/checkEnv.test.js            - 4 tests

## Not changed (as requested)
- WorkspaceStep / bare /register still present.

## Notes
- Docker compose uses NODE_ENV=development, so the boot check won't affect it.
- POST /invitations/accept shares registerLimiter (5/hour/IP), and failed attempts count too.
