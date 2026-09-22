# JopUP Frontend

React + Vite + Tailwind v4 + shadcn/ui. Covers login, self-service
registration, a dashboard shell, and the first real workbench (Employees).
Clients and Managerial are still stub cards on the dashboard.

## Setup

```bash
npm install
npm run dev
```

Requires the backend running and reachable on `http://localhost:3000` (the
Dockerized setup works as-is — no backend changes needed to run this).
Vite's dev server proxies `/api/*` to it (see `vite.config.js`), so the
browser only ever talks to Vite's own origin — no CORS setup needed.

## About the shadcn/ui setup

The `shadcn` CLI (`npx shadcn add ...`) needs to reach `ui.shadcn.com`, which
wasn't reachable from the sandbox this was built in — so the components
under `src/components/ui/` were written by hand instead of generated, using
the same canonical patterns (Tailwind classes, `class-variance-authority`
for variants, Radix primitives only where they're actually needed — Slot for
`Button`'s `asChild`, Label). `components.json` is still included and
correctly configured, so if you run the real CLI later on a machine with
internet access, it'll recognize this as an initialized shadcn project and
`npx shadcn add <component>` will work normally to add more.

One deliberate deviation: `native-select.jsx` is a plain `<select>` styled to
match `Input`, not Radix's `Select` primitive. Radix's version is a bigger,
more stateful component (portal, positioning, keyboard nav) that's harder to
get right without a real browser to test in — a native select covers every
use here (team filters, role pickers) with far less surface area for
something to be subtly wrong. Swap it for the real Radix Select later if you
need multi-select, search, or richer option content.

## How login/registration work

No form asks for a raw organisation slug or a UUID. The org's identity lives
in the URL: `/login/:orgSlug` and `/register/:orgSlug`. Landing on the bare
`/login` or `/register` (no slug) shows a one-time "which workspace" step;
submitting it navigates to the slug-bearing URL, which is then
shareable/bookmarkable. `useOrgLookup` (in `src/hooks/`) resolves that slug
into a display name (and, for registration, a team list) via the backend's
public `GET /organizations/by-slug/:slug` endpoints — the resolved `id`s are
used internally, never shown or typed.

## What's here

- `src/lib/api.js` — fetch wrapper: attaches the JWT from localStorage,
  throws a typed `ApiError` on non-2xx responses.
- `src/lib/utils.js` — `cn()`, the class-merging helper every shadcn
  component uses.
- `src/hooks/useOrgLookup.js` — slug -> org name + team list.
- `src/context/AuthContext.jsx` — session state. Re-hydrates from
  `GET /auth/me` on load rather than trusting the token's own payload.
- `src/components/ProtectedRoute.jsx` — redirects to `/login` when logged
  out.
- `src/components/AppLayout.jsx` — shared header/nav shell for every
  authenticated page.
- `src/components/WorkspaceStep.jsx` — the one-time slug-entry step shared
  by both auth pages.
- `src/components/ui/*` — the hand-written shadcn components (see above).
- `src/pages/LoginPage.jsx`, `RegisterPage.jsx`, `DashboardPage.jsx`,
  `EmployeesPage.jsx`.

## Employees workbench

- Directory table (`GET /api/v1/users`, optional `?teamId=`) with a team
  filter dropdown.
- Pending approvals (`GET /api/v1/auth/pending-approvals`) with
  Approve/Reject — the section only renders if that call actually succeeds
  (org_admin or a team manager); a 401/403 just hides it silently rather
  than showing an error, since "you're not allowed to see this" isn't a
  failure state worth surfacing.
- Status toggle (suspend/reactivate), org_admin only, via
  `PATCH /api/v1/users/:id/status`.

## Next

Clients and Managerial workbenches — same pattern as Employees, against the
routes already verified working in the backend. See the main project
README for the full route list per workbench.
