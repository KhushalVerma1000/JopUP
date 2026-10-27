# Deploy: backend on Render (free), frontend on Vercel (free)

No application code changes. Backend keeps using `server.js` + the existing Dockerfile.

## Files
- `frontend/vercel.json` (new): forwards `/api/*` to the Render service, SPA fallback for everything else.
- `render.yaml` (new): Render Blueprint for the backend (Docker, free plan, health check `/api/health`).
- Delete the root `vercel.json` (it used the `services` config that caused the
  "No exports found in module index.cjs" error): `git rm vercel.json`

## Steps
1. **Database**: create a free Postgres (Neon or Supabase), copy the pooled connection string (needs `?sslmode=require`).
2. **Migrate + seed** from your machine (PowerShell):
   ```
   cd backend
   $env:DATABASE_URL = "<connection string>"
   npm run db:migrate
   npm run db:seed
   ```
3. **Render**: New -> Blueprint -> select the repo. Fill `DATABASE_URL`, and `APP_URL` (use a placeholder, fix in step 5).
   Note the service URL (https://hiretrack-api-xxxx.onrender.com). Check `<url>/api/health` returns `{"status":"ok"}`.
4. **Vercel**: import the repo, set **Root Directory = frontend**. Before pushing, replace
   `REPLACE-WITH-YOUR-SERVICE.onrender.com` in `frontend/vercel.json` with your Render host.
5. Set `APP_URL` on Render to the final Vercel URL, redeploy.

## Known limits of the free setup
- Render free service sleeps after 15 min idle; first request takes ~30-60 s.
- 512 MB RAM: test bulk resume parsing with a few files first.
- Daily tracker emails / hourly KPI sync only run while the service is awake.
- Emails log to console until `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` are set.

## Logo (added)
- `frontend/public/favicon.svg` (replaces the Vite default), `logo-mark.svg` (icon), `logo.svg` (icon + "HireTracker" wordmark; the text uses Plus Jakarta Sans with Segoe UI/Arial fallback).
- `frontend/src/components/AppLayout.jsx` (desktop sidebar + phone header) and `AuthShell.jsx` (login/signup): logo mark added next to the existing "HireTracker" text. Nothing else changed in these files.
- `frontend/index.html`: `theme-color` set to the logo indigo `#4F46E5`.
- Name check: the app text says "HireTracker"; the logo canvas wordmark says "HireTrack". Pick one and keep it the same everywhere.
