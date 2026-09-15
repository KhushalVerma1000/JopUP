#!/usr/bin/env bash
# JopUP API — sequential curl walkthrough.
# Run top to bottom. After each response, copy the field the comment names
# into the matching shell variable below it, then re-run/continue from there.
# jq is used only to pretty-print; if you don't have it, drop ` | jq` from any line.
set -e

baseUrl="http://localhost:3000"
platformOwnerToken=""
platformAdminUserId=""
planId=""
orgId=""
orgSlug=""
orgAdminToken=""
managerToken=""
hrToken=""
seekerToken=""
managerUserId=""
hrUserId=""
invitationId=""
invitationToken=""
teamId=""
teamId2=""
clientId=""
candidateId=""
workflowTemplateId=""
stageId=""
stageId2=""
jobPostingId=""
applicationId=""
logId=""
kpiId=""
reviewId=""
goalId=""
strategyId=""

# ══════════════════════════════════════════════════
# 00 · Health
# ══════════════════════════════════════════════════
# --- Health check ---
curl -sS -X GET \
  "${baseUrl}/api/health" \
  | jq .

# ══════════════════════════════════════════════════
# 01 · Plans (public)
# ══════════════════════════════════════════════════
# --- List plans ---
# NOTE: Copy a plan's id from the response into env var `planId` — you'll need it for org signup below.
curl -sS -X GET \
  "${baseUrl}/api/v1/plans" \
  | jq .

# --- Get plan by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/plans/${planId}" \
  | jq .

# --- Create plan ---
# NOTE: NOTE: this route has no requireAuth at all — anyone can create/edit plans today. Flagged as a gap; fine for internal beta, worth locking to platform_admin before going further.
curl -sS -X POST \
  "${baseUrl}/api/v1/plans" \
  -H "Content-Type: application/json" \
  -d '{"name": "Beta Test Plan", "slug": "beta-test-plan", "description": "Internal plan for beta testing", "priceMonthly": "0", "priceYearly": "0", "modules": ["client_management", "candidate_db", "job_posting", "workflow_engine", "pipeline_tracker", "kpi_engine", "performance_reviews"], "limits": {"max_teams": 10, "max_hrs_per_team": 20, "max_candidates": 5000, "max_clients": 100, "max_job_postings": 50}, "creditAllowance": 500, "creditsEnabled": true, "trialDays": 30}' \
  | jq .

# --- Update plan ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/plans/${planId}" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}' \
  | jq .

# ══════════════════════════════════════════════════
# 02 · Platform Owner (bootstrap via CLI)
# ══════════════════════════════════════════════════
# --- Login as platform_owner ---
# NOTE: There is no HTTP route that creates a platform_owner — it's provisioned once, out-of-band, by running on the backend server:
# NOTE: 
# NOTE:   cd backend && npm run provision:owner -- --email=owner@jopup.io --password=... --firstName=Jane --lastName=Doe
# NOTE: 
# NOTE: Then log in here with organisationSlug: jopup-platform. Copy the response's data.token into env var `platformOwnerToken` — every request in the next folder needs it.
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"organisationSlug": "jopup-platform", "email": "owner@jopup.io", "password": "REPLACE_WITH_REAL_PASSWORD"}' \
  | jq .

# ══════════════════════════════════════════════════
# 03 · Platform Admins (owner-only)
# ══════════════════════════════════════════════════
# --- List platform admins ---
curl -sS -X GET \
  "${baseUrl}/api/v1/platform-admins" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  | jq .

# --- Create platform admin ---
# NOTE: Copy the new user's id into env var `platformAdminUserId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/platform-admins" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  -H "Content-Type: application/json" \
  -d '{"email": "subadmin@jopup.io", "password": "password123", "firstName": "Sam", "lastName": "Sub"}' \
  | jq .

# --- Remove platform admin ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/platform-admins/${platformAdminUserId}" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 04 · Organization Signup (public)
# ══════════════════════════════════════════════════
# --- Sign up org WITH first admin (recommended) ---
# NOTE: NEW: adminEmail/adminPassword/adminFirstName/adminLastName are optional but recommended — without them a freshly signed-up org has NO org_admin and no HTTP path to ever get one (self-registration caps at hr/manager; invitations require an existing org_admin to send them). Copy data.organization.id into env var `orgId` and data.organization.slug into `orgSlug`. Then log in as this admin in folder 05 to get `orgAdminToken`.
curl -sS -X POST \
  "${baseUrl}/api/v1/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Recruiting", "slug": "acme-recruiting", "planId": "${planId}", "timezone": "Asia/Kolkata", "adminEmail": "admin@acme.example", "adminPassword": "password123", "adminFirstName": "Ada", "adminLastName": "Admin"}' \
  | jq .

# --- Sign up org WITHOUT admin (org-only) ---
# NOTE: Leaves the org with no admin — only useful if a platform_admin will invite/assign one manually.
curl -sS -X POST \
  "${baseUrl}/api/v1/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Recruiting 2", "slug": "acme-recruiting-2", "planId": "${planId}"}' \
  | jq .

# ══════════════════════════════════════════════════
# 05 · Staff Auth
# ══════════════════════════════════════════════════
# --- Login as org_admin ---
# NOTE: Copy data.token into env var `orgAdminToken`.
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"organisationSlug": "${orgSlug}", "email": "admin@acme.example", "password": "password123"}' \
  | jq .

# --- Register as manager (self-service, pending) ---
# NOTE: Requires a team to exist first — create one in folder 07 (Teams) using orgAdminToken, then copy its id into `teamId` before running this.
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"organisationId": "${orgId}", "email": "manager@acme.example", "password": "password123", "firstName": "Mona", "lastName": "Manager", "teamId": "${teamId}", "requestedRoleName": "manager"}' \
  | jq .

# --- Register as hr (self-service, pending) ---
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"organisationId": "${orgId}", "email": "hr@acme.example", "password": "password123", "firstName": "Hank", "lastName": "HR", "teamId": "${teamId}", "requestedRoleName": "hr", "requestedManagerId": "${managerUserId}"}' \
  | jq .

# --- List pending approvals ---
# NOTE: Copy a pending user's id into `managerUserId` or `hrUserId` to approve/reject below.
curl -sS -X GET \
  "${baseUrl}/api/v1/auth/pending-approvals" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Approve pending manager ---
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/pending-approvals/${managerUserId}/approve" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Approve pending hr ---
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/pending-approvals/${hrUserId}/approve" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Reject a pending request ---
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/pending-approvals/${hrUserId}/reject" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Role mismatch, please re-apply as hr"}' \
  | jq .

# --- Login as manager ---
# NOTE: Copy data.token into env var `managerToken`. Only works after the approval above.
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"organisationSlug": "${orgSlug}", "email": "manager@acme.example", "password": "password123"}' \
  | jq .

# --- Login as hr ---
# NOTE: Copy data.token into env var `hrToken`. Only works after the approval above.
curl -sS -X POST \
  "${baseUrl}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"organisationSlug": "${orgSlug}", "email": "hr@acme.example", "password": "password123"}' \
  | jq .

# --- Who am I (org_admin) ---
curl -sS -X GET \
  "${baseUrl}/api/v1/auth/me" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Who am I (manager) ---
curl -sS -X GET \
  "${baseUrl}/api/v1/auth/me" \
  -H "Authorization: Bearer ${managerToken}" \
  | jq .

# --- Who am I (hr) ---
# NOTE: NEW route — didn't exist before. Every UI needs this on load to hydrate the session (name/avatar/status can change after the JWT was issued).
curl -sS -X GET \
  "${baseUrl}/api/v1/auth/me" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 06 · Invitations
# ══════════════════════════════════════════════════
# --- Invite an org_admin ---
# NOTE: No teamId for org_admin invites. No email provider is wired up — the raw token comes back in the response; copy it into `invitationToken`.
curl -sS -X POST \
  "${baseUrl}/api/v1/invitations" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"email": "second-admin@acme.example", "roleName": "org_admin"}' \
  | jq .

# --- Invite a manager (team-scoped) ---
curl -sS -X POST \
  "${baseUrl}/api/v1/invitations" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"email": "manager2@acme.example", "roleName": "manager", "teamId": "${teamId}"}' \
  | jq .

# --- List invitations ---
# NOTE: Copy a pending invitation's id into env var `invitationId` to try revoke below.
curl -sS -X GET \
  "${baseUrl}/api/v1/invitations" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Accept invitation (public) ---
# NOTE: Returns a login token immediately — no approval step needed, the inviting org_admin already vetted them.
curl -sS -X POST \
  "${baseUrl}/api/v1/invitations/accept" \
  -H "Content-Type: application/json" \
  -d '{"token": "${invitationToken}", "password": "password123", "firstName": "Second", "lastName": "Admin"}' \
  | jq .

# --- Revoke invitation ---
curl -sS -X POST \
  "${baseUrl}/api/v1/invitations/${invitationId}/revoke" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 07 · Teams
# ══════════════════════════════════════════════════
# --- Create team ---
# NOTE: Copy the new team's id into env var `teamId`. Create a SECOND team the same way and copy its id into `teamId2` — several requests below (client/candidate sharing) need a second team to share into.
curl -sS -X POST \
  "${baseUrl}/api/v1/teams" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Recruitment Team A", "description": "Primary recruiting pod"}' \
  | jq .

# --- List teams ---
# NOTE: Open to any authenticated staff — try with orgAdminToken/managerToken/hrToken interchangeably.
curl -sS -X GET \
  "${baseUrl}/api/v1/teams" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Get team by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/teams/${teamId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Update team ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/teams/${teamId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}' \
  | jq .

# --- Delete team ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/teams/${teamId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 08 · Users - Employees (NEW)
# ══════════════════════════════════════════════════
# --- List employees ---
# NOTE: NEW route — previously there was no way to list staff at all, even though invitations/approvals could create them. Try `?teamId={{teamId}}` or `?status=active` as query params.
curl -sS -X GET \
  "${baseUrl}/api/v1/users" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- List employees filtered by team ---
curl -sS -X GET \
  "${baseUrl}/api/v1/users?teamId=${teamId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Get employee by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/users/${hrUserId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Update own profile (self) ---
# NOTE: Self-edit works; try editing someone else's id with the same token to see the 403.
curl -sS -X PATCH \
  "${baseUrl}/api/v1/users/${hrUserId}" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "Hank", "lastName": "HR-Updated", "phone": "+91-9999999999"}' \
  | jq .

# --- Change employee status (org_admin only) ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/users/${hrUserId}/status" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "suspended"}' \
  | jq .

# --- Reactivate employee ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/users/${hrUserId}/status" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}' \
  | jq .

# --- Deactivate (soft-delete) employee ---
# NOTE: Sets status to 'inactive' — never a hard delete, since user rows are referenced from audit_log/approvals/assignments.
curl -sS -X DELETE \
  "${baseUrl}/api/v1/users/${hrUserId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 09 · Org Settings (NEW self-service)
# ══════════════════════════════════════════════════
# --- Get my organization ---
# NOTE: NEW — previously org_admin had zero permission to view/edit their own org (organisations:read/write was platform_admin-only). Any authenticated staff can GET; only org_admin can PATCH.
curl -sS -X GET \
  "${baseUrl}/api/v1/organizations/me" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Get my organization's enabled modules ---
curl -sS -X GET \
  "${baseUrl}/api/v1/organizations/me/modules" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Update my organization (org_admin only) ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/organizations/me" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Recruiting Pvt Ltd", "timezone": "Asia/Kolkata", "logoUrl": "https://example.com/logo.png"}' \
  | jq .

# ══════════════════════════════════════════════════
# 10 · Organizations (platform-admin only)
# ══════════════════════════════════════════════════
# --- List all organizations ---
curl -sS -X GET \
  "${baseUrl}/api/v1/organizations" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  | jq .

# --- Get organization by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/organizations/${orgId}" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  | jq .

# --- Update organization (plan/status) ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/organizations/${orgId}" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}' \
  | jq .

# --- Get organization's modules ---
curl -sS -X GET \
  "${baseUrl}/api/v1/organizations/${orgId}/modules" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 11 · Clients
# ══════════════════════════════════════════════════
# --- Create client ---
# NOTE: Copy the new client's id into env var `clientId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/clients" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"companyName": "Beta Corp", "ownerTeamId": "${teamId}", "industry": "Software", "website": "https://betacorp.example", "contactName": "Chris Contact", "contactEmail": "chris@betacorp.example", "contactPhone": "+91-9000000000", "sharedOrgWide": false}' \
  | jq .

# --- List clients (org-wide) ---
curl -sS -X GET \
  "${baseUrl}/api/v1/clients" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- List clients (team-scoped) ---
curl -sS -X GET \
  "${baseUrl}/api/v1/clients?teamId=${teamId}" \
  -H "Authorization: Bearer ${managerToken}" \
  | jq .

# --- Get client by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/clients/${clientId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Update client ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/clients/${clientId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}' \
  | jq .

# --- Share client with another team ---
curl -sS -X POST \
  "${baseUrl}/api/v1/clients/${clientId}/share" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"teamId": "${teamId2}", "canWrite": false}' \
  | jq .

# --- Delete client ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/clients/${clientId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 12 · Candidates
# ══════════════════════════════════════════════════
# --- Create candidate ---
# NOTE: Copy the new candidate's id into env var `candidateId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/candidates" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "Cara", "lastName": "Candidate", "ownerTeamId": "${teamId}", "email": "cara.candidate@example.com", "phone": "+91-9111111111", "source": "manual", "skills": ["node.js", "postgres"]}' \
  | jq .

# --- List candidates ---
curl -sS -X GET \
  "${baseUrl}/api/v1/candidates" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Get candidate by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/candidates/${candidateId}" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update candidate ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/candidates/${candidateId}" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "active", "notes": "Strong backend candidate"}' \
  | jq .

# --- Grant team access to candidate ---
curl -sS -X POST \
  "${baseUrl}/api/v1/candidates/${candidateId}/access" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"teamId": "${teamId2}", "canWrite": false}' \
  | jq .

# --- Delete candidate (org_admin only) ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/candidates/${candidateId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 13 · Workflow Templates
# ══════════════════════════════════════════════════
# --- Create workflow template ---
# NOTE: Copy the new template's id into env var `workflowTemplateId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/workflows" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Standard Hiring Pipeline", "teamId": "${teamId}", "description": "Default pipeline for team A"}' \
  | jq .

# --- List workflow templates ---
curl -sS -X GET \
  "${baseUrl}/api/v1/workflows" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Get workflow template ---
curl -sS -X GET \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update workflow template ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"isDefault": true}' \
  | jq .

# --- Add stage: Applied ---
# NOTE: Copy this stage's id into `stageId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}/stages" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Applied", "stageKey": "applied", "orderIndex": 0}' \
  | jq .

# --- Add stage: Interview ---
# NOTE: Copy this stage's id into `stageId2` — you'll advance an application to it later.
curl -sS -X POST \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}/stages" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Interview", "stageKey": "interview", "orderIndex": 1, "requiresApproval": false}' \
  | jq .

# --- Add stage: Offer (final success) ---
curl -sS -X POST \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}/stages" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Offer", "stageKey": "offer", "orderIndex": 2, "isFinalSuccess": true}' \
  | jq .

# --- List stages ---
curl -sS -X GET \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}/stages" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update stage ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}/stages/${stageId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Delete stage ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}/stages/${stageId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Delete workflow template ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/workflows/${workflowTemplateId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 14 · Job Postings
# ══════════════════════════════════════════════════
# --- Create job posting ---
# NOTE: Copy the new posting's id into env var `jobPostingId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/job-postings" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Backend Engineer", "description": "Build and maintain our core services.", "teamId": "${teamId}", "clientId": "${clientId}", "workflowTemplateId": "${workflowTemplateId}", "location": "Remote", "workMode": "remote", "employmentType": "full_time", "salaryMin": 800000, "salaryMax": 1500000, "salaryCurrency": "INR", "requiredSkills": ["node.js", "postgres"], "vacancies": 2}' \
  | jq .

# --- List job postings ---
curl -sS -X GET \
  "${baseUrl}/api/v1/job-postings" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Get job posting by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/job-postings/${jobPostingId}" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update job posting ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/job-postings/${jobPostingId}" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"vacancies": 3}' \
  | jq .

# --- Publish job posting ---
# NOTE: Publish before testing the Job Portal folder below — only published postings show up there.
curl -sS -X POST \
  "${baseUrl}/api/v1/job-postings/${jobPostingId}/publish" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Close job posting ---
curl -sS -X POST \
  "${baseUrl}/api/v1/job-postings/${jobPostingId}/close" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Delete job posting ---
curl -sS -X DELETE \
  "${baseUrl}/api/v1/job-postings/${jobPostingId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# ══════════════════════════════════════════════════
# 15 · Applications
# ══════════════════════════════════════════════════
# --- Create application ---
# NOTE: Copy the new application's id into env var `applicationId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/applications" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"candidateId": "${candidateId}", "jobPostingId": "${jobPostingId}", "teamId": "${teamId}", "workflowTemplateId": "${workflowTemplateId}", "entrySource": "direct"}' \
  | jq .

# --- List applications ---
curl -sS -X GET \
  "${baseUrl}/api/v1/applications" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Get application by id ---
curl -sS -X GET \
  "${baseUrl}/api/v1/applications/${applicationId}" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Advance to next stage ---
# NOTE: nextStageId must be a real stage id from folder 13 (use the 'Interview' stage you saved as stageId2).
curl -sS -X POST \
  "${baseUrl}/api/v1/applications/${applicationId}/advance" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"nextStageId": "${stageId2}"}' \
  | jq .

# --- Block application ---
curl -sS -X POST \
  "${baseUrl}/api/v1/applications/${applicationId}/block" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Candidate unresponsive"}' \
  | jq .

# --- Put application on hold ---
curl -sS -X POST \
  "${baseUrl}/api/v1/applications/${applicationId}/hold" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Get application stage history ---
# NOTE: Copy a stage log id from the response into env var `logId` to try the action endpoint below.
curl -sS -X GET \
  "${baseUrl}/api/v1/applications/${applicationId}/history" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Add action to a stage log ---
curl -sS -X POST \
  "${baseUrl}/api/v1/applications/${applicationId}/stages/${logId}/actions" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"actionType": "note", "content": "Left a voicemail, following up tomorrow."}' \
  | jq .

# ══════════════════════════════════════════════════
# 16 · Performance
# ══════════════════════════════════════════════════
# --- Create KPI ---
# NOTE: Copy the new KPI's id into env var `kpiId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/performance/kpis" \
  -H "Authorization: Bearer ${managerToken}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Placements per month", "teamId": "${teamId}", "category": "output", "unit": "count", "frequency": "monthly", "targetValue": 5, "direction": "higher_better"}' \
  | jq .

# --- List KPIs ---
curl -sS -X GET \
  "${baseUrl}/api/v1/performance/kpis" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update KPI ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/performance/kpis/${kpiId}" \
  -H "Authorization: Bearer ${managerToken}" \
  -H "Content-Type: application/json" \
  -d '{"targetValue": 6}' \
  | jq .

# --- List KPI entries ---
curl -sS -X GET \
  "${baseUrl}/api/v1/performance/kpis/${kpiId}/entries" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Add KPI entry ---
curl -sS -X POST \
  "${baseUrl}/api/v1/performance/kpi-entries" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"kpiId": "${kpiId}", "teamId": "${teamId}", "value": 4, "periodLabel": "2026-09"}' \
  | jq .

# --- Create performance review ---
# NOTE: Copy the new review's id into env var `reviewId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/performance/reviews" \
  -H "Authorization: Bearer ${managerToken}" \
  -H "Content-Type: application/json" \
  -d '{"teamId": "${teamId}", "revieweeId": "${hrUserId}", "cycle": "2026-Q3", "summary": "Solid quarter."}' \
  | jq .

# --- List performance reviews ---
curl -sS -X GET \
  "${baseUrl}/api/v1/performance/reviews" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update performance review ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/performance/reviews/${reviewId}" \
  -H "Authorization: Bearer ${managerToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "submitted"}' \
  | jq .

# --- Create goal ---
# NOTE: Copy the new goal's id into env var `goalId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/performance/goals" \
  -H "Authorization: Bearer ${managerToken}" \
  -H "Content-Type: application/json" \
  -d '{"teamId": "${teamId}", "title": "Fill 5 open reqs", "assignedTo": "${hrUserId}", "progressPct": 0}' \
  | jq .

# --- List goals ---
curl -sS -X GET \
  "${baseUrl}/api/v1/performance/goals" \
  -H "Authorization: Bearer ${hrToken}" \
  | jq .

# --- Update goal ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/performance/goals/${goalId}" \
  -H "Authorization: Bearer ${hrToken}" \
  -H "Content-Type: application/json" \
  -d '{"progressPct": 40}' \
  | jq .

# --- Create strategy ---
# NOTE: Copy the new strategy's id into env var `strategyId`.
curl -sS -X POST \
  "${baseUrl}/api/v1/performance/strategies" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"teamId": "${teamId}", "title": "Q4 hiring push", "period": "2026-Q4", "status": "active"}' \
  | jq .

# --- List strategies ---
curl -sS -X GET \
  "${baseUrl}/api/v1/performance/strategies" \
  -H "Authorization: Bearer ${managerToken}" \
  | jq .

# --- Update strategy ---
curl -sS -X PATCH \
  "${baseUrl}/api/v1/performance/strategies/${strategyId}" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}' \
  | jq .

# ══════════════════════════════════════════════════
# 17 · Credits
# ══════════════════════════════════════════════════
# --- List credit costs ---
curl -sS -X GET \
  "${baseUrl}/api/v1/credits/costs" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Get credit balance ---
curl -sS -X GET \
  "${baseUrl}/api/v1/credits/balance" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- List credit transactions ---
curl -sS -X GET \
  "${baseUrl}/api/v1/credits/transactions?limit=20&offset=0" \
  -H "Authorization: Bearer ${orgAdminToken}" \
  | jq .

# --- Top up credits (platform_admin only) ---
curl -sS -X POST \
  "${baseUrl}/api/v1/credits/top-up" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100, "description": "Beta test top-up"}' \
  | jq .

# --- Adjust credits (platform_admin only) ---
curl -sS -X POST \
  "${baseUrl}/api/v1/credits/adjust" \
  -H "Authorization: Bearer ${platformOwnerToken}" \
  -H "Content-Type: application/json" \
  -d '{"amount": -10, "description": "Correction for double-charge"}' \
  | jq .

# ══════════════════════════════════════════════════
# 18 · Job Portal - org-scoped (public)
# ══════════════════════════════════════════════════
# --- Get org's public profile ---
curl -sS -X GET \
  "${baseUrl}/api/v1/portal/${orgSlug}" \
  | jq .

# --- List published jobs for org ---
curl -sS -X GET \
  "${baseUrl}/api/v1/portal/${orgSlug}/jobs" \
  | jq .

# --- Get a single published job ---
curl -sS -X GET \
  "${baseUrl}/api/v1/portal/${orgSlug}/jobs/${jobPostingId}" \
  | jq .

# --- Submit application via portal ---
# NOTE: No account needed — this is the anonymous/guest apply path (job-portal.routes.js).
curl -sS -X POST \
  "${baseUrl}/api/v1/portal/${orgSlug}/apply" \
  -H "Content-Type: application/json" \
  -d '{"jobPostingId": "${jobPostingId}", "firstName": "Percy", "lastName": "Portal", "email": "percy.portal@example.com", "phone": "+91-9222222222"}' \
  | jq .

# ══════════════════════════════════════════════════
# 18b · Job Seeker Auth (separate JWT, portal.routes.js)
# ══════════════════════════════════════════════════
# --- Register job seeker ---
curl -sS -X POST \
  "${baseUrl}/api/v1/portal/register" \
  -H "Content-Type: application/json" \
  -d '{"email": "seeker@example.com", "password": "password123", "firstName": "Sam", "lastName": "Seeker"}' \
  | jq .

# --- Login job seeker ---
# NOTE: Copy data.token into env var `seekerToken`.
curl -sS -X POST \
  "${baseUrl}/api/v1/portal/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "seeker@example.com", "password": "password123"}' \
  | jq .

# --- List jobs (portal.routes variant) ---
curl -sS -X GET \
  "${baseUrl}/api/v1/portal/jobs" \
  | jq .

# --- Get job by id (portal.routes variant) ---
curl -sS -X GET \
  "${baseUrl}/api/v1/portal/jobs/${jobPostingId}" \
  | jq .

# --- Apply as logged-in job seeker ---
# NOTE: IMPORTANT: portal.routes.js and job-portal.routes.js are two separate, overlapping route modules BOTH mounted at /api/v1/portal in app.js (only job-portal.routes.js is actually wired up there — portal.routes.js's file exists but isn't require()'d/mounted in app.js at all, so this specific request and the two above it in this sub-folder will 404 until someone decides which implementation is canonical and mounts/removes the other. Flagged as a cleanup item, not fixed here since picking a winner is a product decision, not a bug fix.
curl -sS -X POST \
  "${baseUrl}/api/v1/portal/apply" \
  -H "Authorization: Bearer ${seekerToken}" \
  -H "Content-Type: application/json" \
  -d '{"jobPostingId": "${jobPostingId}"}' \
  | jq .

