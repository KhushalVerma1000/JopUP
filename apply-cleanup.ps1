# Run from the repo root AFTER extracting this zip with -Force.
# Expand-Archive cannot delete files, so this removes the dead ones.
$del = @(
 'frontend/src/pages/HrClassicPage.jsx',
 'backend/src/features/job-portal/portal.controller.js',
 'backend/src/features/job-portal/portal.routes.js',
 'backend/src/features/job-portal/portal.schema.js',
 'backend/src/features/job-portal/portal.service.js',
 'backend/drizzle/migrations/0000_sleepy_northstar.sql',
 'backend/drizzle/migrations/0001_confused_peter_parker.sql',
 'backend/drizzle/migrations/0002_slippery_starbolt.sql',
 'backend/drizzle/migrations/0003_staff_self_registration.sql',
 'backend/drizzle/migrations/0004_candidate_created_by_nullable.sql',
 'backend/drizzle/migrations/meta/0000_snapshot.json',
 'backend/drizzle/migrations/meta/0001_snapshot.json',
 'backend/drizzle/migrations/meta/0002_snapshot.json',
 'backend/drizzle/migrations/meta/0003_snapshot.json',
 'backend/drizzle/migrations/meta/0004_snapshot.json'
)
foreach ($f in $del) { if (Test-Path $f) { git rm -q -f $f; Write-Host "removed $f" } }
