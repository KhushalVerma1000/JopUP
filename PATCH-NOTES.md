# JopUP — role-based interfaces, signup, platform console, demo seed

## Apply (PowerShell, from repo root)
    Expand-Archive -Force .\jopup-roles-ui-patch.zip .
    cd backend; npm run db:seed:demo -- --reset
    # frontend renamed HrPage -> HrClassicPage: delete nothing, the zip includes both files.

## Demo logins (password for all: Password123!)
owner@jopup.dev (platform_owner) · padmin@jopup.dev (platform_admin)
admin@acme.test (org_admin, Pro, active) · manager.tech@acme.test · manager.sales@acme.test
hr.tech@acme.test · hr.tech2@acme.test · hr.sales@acme.test
admin@northwind.test (trial, 3 days left) · manager@northwind.test · hr@northwind.test
multi@demo.test (in Acme AND Northwind -> workspace picker)
admin@globex.test (Enterprise) · admin@initech.test (suspended -> blocked at login)
new.hr@acme.test / new.manager@acme.test = pending approvals

## Backend
- POST /api/v1/auth/signup  (public, 5/hr/IP): org + first org_admin + "General" team + credit account
  + trialing subscription (paymentProvider null = payment-module hook). Slug auto-generated. Returns session.
- GET /api/v1/platform/metrics | /organizations | /organizations/:id  (organisations:read -> platform roles only)
- POST /api/v1/trackers/:id/resume  (hold had no way back)
- Suspended/cancelled orgs can no longer log in.
- SECURITY FIX: POST/PATCH /api/v1/plans were unauthenticated -> now plans:write (platform staff).
- Fixed org status enum in PATCH schema ('trial' -> 'trialing').
- LOGIN_RATE_LIMIT_MAX / SIGNUP_RATE_LIMIT_MAX / PLATFORM_ORG_SLUG env overrides.
- npm run db:seed:demo [-- --reset]
