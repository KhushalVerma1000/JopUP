#!/usr/bin/env bash
###############################################################################
# JopUP API — Automated End-to-End Test Script
#
# Runs every route as a real sequence: signs up an org, logs in, creates
# teams/clients/candidates/workflows/jobs/applications/etc., and asserts each
# response. Nothing is copy-pasted by hand — each segment extracts what the
# next one needs (plan id, tokens, team/client/candidate ids, ...) with jq
# and stashes it in a small state file, so you can:
#
#   ./jopup-e2e-test.sh              # run everything, in order
#   ./jopup-e2e-test.sh teams        # run just one segment
#   ./jopup-e2e-test.sh clients candidates   # run a few, in the order given
#   ./jopup-e2e-test.sh list         # show all segment names
#   ./jopup-e2e-test.sh reset        # wipe saved state, start clean next run
#
# Requires: curl, jq. Nothing else.
#
# Config (env vars, all optional):
#   BASE_URL                default http://localhost:3000
#   STATE_FILE              default .jopup-test-state.env (next to this script)
#   PLATFORM_OWNER_EMAIL    only needed for the 'owner'/'platform_admins' segments
#   PLATFORM_OWNER_PASSWORD (provision the owner first — see the 'owner' segment)
#
# Re-running is safe: once a segment has created its thing (an org, a team, a
# client...) it caches the id in the state file and skips re-creating it on
# the next run — it just re-runs the GET/list checks against the cached id.
# Use `reset` to force everything to be created fresh.
###############################################################################
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.jopup-test-state.env}"
PLATFORM_OWNER_EMAIL="${PLATFORM_OWNER_EMAIL:-}"
PLATFORM_OWNER_PASSWORD="${PLATFORM_OWNER_PASSWORD:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v jq   >/dev/null || { echo "jq is required (brew install jq / apt install jq)"; exit 1; }

# ── State persistence ────────────────────────────────────────────────────
touch "$STATE_FILE"
# shellcheck disable=SC1090
source "$STATE_FILE"

save() {
  local key="$1" val="$2"
  grep -v "^${key}=" "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null || true
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  printf '%s=%q\n' "$key" "$val" >> "$STATE_FILE"
  printf -v "$key" '%s' "$val"
}

# ── HTTP helper ──────────────────────────────────────────────────────────
# call METHOD PATH [BODY_JSON] [AUTH_VAR_NAME]
# sets $STATUS and $BODY
call() {
  local method="$1" path="$2" body="${3:-}" authvar="${4:-}"
  local args=(-sS -X "$method" "${BASE_URL}${path}" -w '\n%{http_code}')
  if [[ -n "$authvar" ]]; then
    local token="${!authvar:-}"
    args+=(-H "Authorization: Bearer ${token}")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  local raw
  raw=$(curl "${args[@]}" 2>/dev/null) || true
  STATUS="${raw##*$'\n'}"
  BODY="${raw%$'\n'*}"
}

ok() {
  local label="$1"
  if [[ "$STATUS" =~ ^2 ]]; then
    PASS_COUNT=$((PASS_COUNT+1))
    echo -e "  ${GREEN}✓${NC} $label ${BLUE}[$STATUS]${NC}"
    return 0
  else
    FAIL_COUNT=$((FAIL_COUNT+1))
    echo -e "  ${RED}✗${NC} $label ${RED}[$STATUS]${NC}"
    echo "      $(echo "$BODY" | head -c 300)"
    return 1
  fi
}

# expect_status "403" label   — for negative tests (permission checks)
expect_status() {
  local expected="$1" label="$2"
  if [[ "$STATUS" == "$expected" ]]; then
    PASS_COUNT=$((PASS_COUNT+1))
    echo -e "  ${GREEN}✓${NC} $label ${BLUE}[$STATUS as expected]${NC}"
    return 0
  else
    FAIL_COUNT=$((FAIL_COUNT+1))
    echo -e "  ${RED}✗${NC} $label ${RED}[got $STATUS, expected $expected]${NC}"
    echo "      $(echo "$BODY" | head -c 300)"
    return 1
  fi
}

skip() {
  local label="$1" reason="$2"
  SKIP_COUNT=$((SKIP_COUNT+1))
  echo -e "  ${YELLOW}⊘${NC} $label ${YELLOW}(skipped: $reason)${NC}"
}

need() {
  # need VAR1 VAR2 ... -> prints the first unset one and returns 1
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      echo "$v"
      return 1
    fi
  done
  return 0
}

header() { echo; echo -e "${BOLD}${BLUE}━━━ $1 ━━━${NC}"; }

# ═══════════════════════════════════════════════════════════════════════
# 00 · Health
# ═══════════════════════════════════════════════════════════════════════
seg_health() {
  header "00 · Health"
  call GET "/api/health"
  ok "GET /api/health"
}

# ═══════════════════════════════════════════════════════════════════════
# 01 · Plans
# ═══════════════════════════════════════════════════════════════════════
seg_plans() {
  header "01 · Plans"
  call GET "/api/v1/plans"
  if ok "GET /api/v1/plans"; then
    if [[ -z "${planId:-}" ]]; then
      # Don't just grab [0] — plan row order isn't guaranteed (no ORDER BY
      # in the list query), and the seeded 'Starter'/'Pro' plans have an
      # EMPTY modules array (only 'Enterprise' has the full set). Grabbing
      # an arbitrary plan silently made every module-gated feature 403 for
      # reasons that had nothing to do with the middleware itself. Pick
      # whichever plan has the most modules instead.
      local existing
      existing=$(echo "$BODY" | jq -r '(.data.plans // .data) | sort_by(-(.modules | length)) | .[0].id // empty')
      [[ -n "$existing" ]] && save planId "$existing"
    fi
  fi

  if [[ -n "${planId:-}" ]]; then
    echo "    (using planId=$planId)"
    call GET "/api/v1/plans/${planId}"
    ok "GET /api/v1/plans/:id"
  else
    local body
    body=$(jq -n --arg n "Beta Test Plan $RUN_ID" --arg s "beta-test-plan-$RUN_ID" '{
      name: $n, slug: $s, description: "Auto-created by e2e test script",
      priceMonthly: "0", priceYearly: "0",
      modules: ["client_management","candidate_db","job_posting","workflow_engine","pipeline_tracker","kpi_engine","performance_reviews"],
      limits: {max_teams:10, max_hrs_per_team:20, max_candidates:5000, max_clients:100, max_job_postings:50},
      creditAllowance: 500, creditsEnabled: true, trialDays: 30
    }')
    call POST "/api/v1/plans" "$body"
    if ok "POST /api/v1/plans (create — NOTE: this route has no auth check at all today)"; then
      save planId "$(echo "$BODY" | jq -r '.data.plan.id')"
    fi
  fi

  if [[ -n "${planId:-}" ]]; then
    call PATCH "/api/v1/plans/${planId}" '{"description":"Updated by e2e test script"}'
    ok "PATCH /api/v1/plans/:id"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 02 · Platform Owner + Platform Admins (needs PLATFORM_OWNER_EMAIL/PASSWORD)
# ═══════════════════════════════════════════════════════════════════════
seg_owner() {
  header "02 · Platform Owner"
  if [[ -z "$PLATFORM_OWNER_EMAIL" || -z "$PLATFORM_OWNER_PASSWORD" ]]; then
    skip "Login as platform_owner" "set PLATFORM_OWNER_EMAIL/PLATFORM_OWNER_PASSWORD env vars. First provision one: cd backend && npm run provision:owner -- --email=... --password=... --firstName=... --lastName=..."
    return
  fi
  local body
  body=$(jq -n --arg e "$PLATFORM_OWNER_EMAIL" --arg p "$PLATFORM_OWNER_PASSWORD" \
    '{organisationSlug:"jopup-platform", email:$e, password:$p}')
  call POST "/api/v1/auth/login" "$body"
  if ok "Login as platform_owner"; then
    save platformOwnerToken "$(echo "$BODY" | jq -r '.data.token')"
  fi
}

seg_platform_admins() {
  header "03 · Platform Admins"
  if [[ -z "${platformOwnerToken:-}" ]]; then
    skip "Platform admin CRUD" "platformOwnerToken not set — run: $0 owner (needs PLATFORM_OWNER_EMAIL/PASSWORD)"
    return
  fi
  call GET "/api/v1/platform-admins" "" platformOwnerToken
  ok "GET /api/v1/platform-admins"

  if [[ -z "${platformAdminUserId:-}" ]]; then
    local body
    body=$(jq -n --arg e "subadmin-$RUN_ID@jopup.io" '{email:$e, password:"password123", firstName:"Sam", lastName:"Sub"}')
    call POST "/api/v1/platform-admins" "$body" platformOwnerToken
    if ok "POST /api/v1/platform-admins (create)"; then
      save platformAdminUserId "$(echo "$BODY" | jq -r '.data.admin.id')"
    fi
  else
    echo "    (using cached platformAdminUserId=$platformAdminUserId)"
  fi

  if [[ -n "${platformAdminUserId:-}" ]]; then
    call DELETE "/api/v1/platform-admins/${platformAdminUserId}" "" platformOwnerToken
    ok "DELETE /api/v1/platform-admins/:id"
    save platformAdminUserId ""   # consumed — a fresh one gets created next run
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 04 · Organization Signup (public — creates org + first org_admin together)
# ═══════════════════════════════════════════════════════════════════════
seg_org_signup() {
  header "04 · Organization Signup"
  if [[ -n "${orgId:-}" ]]; then
    echo "    (using cached orgId=$orgId, orgSlug=$orgSlug)"
    return
  fi
  local missing
  if ! missing=$(need planId); then
    skip "POST /api/v1/organizations" "$missing not set — run: $0 plans"
    return
  fi

  local slug="acme-recruiting-$RUN_ID"
  local adminEmail="admin-$RUN_ID@acme.example"
  local body
  body=$(jq -n --arg name "Acme Recruiting $RUN_ID" --arg slug "$slug" --arg planId "$planId" \
    --arg adminEmail "$adminEmail" --arg adminPassword "password123" \
    '{name:$name, slug:$slug, planId:$planId, timezone:"Asia/Kolkata",
      adminEmail:$adminEmail, adminPassword:$adminPassword,
      adminFirstName:"Ada", adminLastName:"Admin"}')
  call POST "/api/v1/organizations" "$body"
  if ok "POST /api/v1/organizations (signup + first org_admin)"; then
    save orgId "$(echo "$BODY" | jq -r '.data.organization.id')"
    save orgSlug "$slug"
    save orgAdminEmail "$adminEmail"
    save orgAdminPassword "password123"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 05 · org_admin login + /auth/me + /organizations/me self-service
# ═══════════════════════════════════════════════════════════════════════
seg_org_admin_login() {
  header "05 · org_admin Login & Self-Service"
  local missing
  if ! missing=$(need orgSlug orgAdminEmail orgAdminPassword); then
    skip "Login as org_admin" "$missing not set — run: $0 org_signup"
    return
  fi

  local body
  body=$(jq -n --arg s "$orgSlug" --arg e "$orgAdminEmail" --arg p "$orgAdminPassword" \
    '{organisationSlug:$s, email:$e, password:$p}')
  call POST "/api/v1/auth/login" "$body"
  if ok "Login as org_admin"; then
    save orgAdminToken "$(echo "$BODY" | jq -r '.data.token')"
  fi

  if [[ -n "${orgAdminToken:-}" ]]; then
    call GET "/api/v1/auth/me" "" orgAdminToken
    ok "GET /api/v1/auth/me"

    call GET "/api/v1/organizations/me" "" orgAdminToken
    ok "GET /api/v1/organizations/me"

    call GET "/api/v1/organizations/me/modules" "" orgAdminToken
    ok "GET /api/v1/organizations/me/modules"

    call PATCH "/api/v1/organizations/me" '{"name":"Acme Recruiting Pvt Ltd"}' orgAdminToken
    ok "PATCH /api/v1/organizations/me"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 06 · Teams
# ═══════════════════════════════════════════════════════════════════════
seg_teams() {
  header "06 · Teams"
  if [[ -z "${orgAdminToken:-}" ]]; then
    skip "Team CRUD" "orgAdminToken not set — run: $0 org_admin_login"
    return
  fi

  if [[ -z "${teamId:-}" ]]; then
    call POST "/api/v1/teams" '{"name":"Recruitment Team A","description":"Primary recruiting pod"}' orgAdminToken
    if ok "POST /api/v1/teams (create team A)"; then
      save teamId "$(echo "$BODY" | jq -r '.data.team.id')"
    fi
  else
    echo "    (using cached teamId=$teamId)"
  fi

  if [[ -z "${teamId2:-}" ]]; then
    call POST "/api/v1/teams" '{"name":"Recruitment Team B","description":"Second pod for share/access tests"}' orgAdminToken
    if ok "POST /api/v1/teams (create team B)"; then
      save teamId2 "$(echo "$BODY" | jq -r '.data.team.id')"
    fi
  else
    echo "    (using cached teamId2=$teamId2)"
  fi

  call GET "/api/v1/teams" "" orgAdminToken
  ok "GET /api/v1/teams"

  if [[ -n "${teamId:-}" ]]; then
    call GET "/api/v1/teams/${teamId}" "" orgAdminToken
    ok "GET /api/v1/teams/:id"

    call PATCH "/api/v1/teams/${teamId}" '{"description":"Updated by e2e test script"}' orgAdminToken
    ok "PATCH /api/v1/teams/:id"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 07 · Staff registration + approval (manager & hr)
# ═══════════════════════════════════════════════════════════════════════
seg_staff_register() {
  header "07 · Staff Registration & Approval"
  local missing
  if ! missing=$(need orgId teamId orgAdminToken); then
    skip "Staff registration" "$missing not set — run: $0 org_signup teams org_admin_login"
    return
  fi

  local managerEmail="manager-$RUN_ID@acme.example"
  local hrEmail="hr-$RUN_ID@acme.example"
  save managerEmail "$managerEmail"
  save hrEmail "$hrEmail"
  save staffPassword "password123"

  if [[ -z "${managerUserId:-}" ]]; then
    local body
    body=$(jq -n --arg orgId "$orgId" --arg teamId "$teamId" --arg e "$managerEmail" \
      '{organisationId:$orgId, email:$e, password:"password123", firstName:"Mona", lastName:"Manager",
        teamId:$teamId, requestedRoleName:"manager"}')
    call POST "/api/v1/auth/register" "$body"
    if ok "POST /api/v1/auth/register (manager, pending)"; then
      save managerUserId "$(echo "$BODY" | jq -r '.data.user.id')"
    fi
  else
    echo "    (using cached managerUserId=$managerUserId)"
  fi

  if [[ -z "${hrUserId:-}" ]]; then
    local body2
    body2=$(jq -n --arg orgId "$orgId" --arg teamId "$teamId" --arg e "$hrEmail" \
      '{organisationId:$orgId, email:$e, password:"password123", firstName:"Hank", lastName:"HR",
        teamId:$teamId, requestedRoleName:"hr"}')
    call POST "/api/v1/auth/register" "$body2"
    if ok "POST /api/v1/auth/register (hr, pending)"; then
      save hrUserId "$(echo "$BODY" | jq -r '.data.user.id')"
    fi
  else
    echo "    (using cached hrUserId=$hrUserId)"
  fi

  call GET "/api/v1/auth/pending-approvals" "" orgAdminToken
  ok "GET /api/v1/auth/pending-approvals"

  if [[ -n "${managerUserId:-}" ]]; then
    call POST "/api/v1/auth/pending-approvals/${managerUserId}/approve" "" orgAdminToken
    ok "POST /api/v1/auth/pending-approvals/:id/approve (manager)"
  fi
  if [[ -n "${hrUserId:-}" ]]; then
    call POST "/api/v1/auth/pending-approvals/${hrUserId}/approve" "" orgAdminToken
    ok "POST /api/v1/auth/pending-approvals/:id/approve (hr)"
  fi
}

seg_staff_login() {
  header "08 · Staff Login (manager / hr)"
  local missing
  if ! missing=$(need orgSlug managerEmail hrEmail staffPassword); then
    skip "Staff login" "$missing not set — run: $0 staff_register"
    return
  fi

  local mbody
  mbody=$(jq -n --arg s "$orgSlug" --arg e "$managerEmail" --arg p "$staffPassword" '{organisationSlug:$s, email:$e, password:$p}')
  call POST "/api/v1/auth/login" "$mbody"
  if ok "Login as manager"; then
    save managerToken "$(echo "$BODY" | jq -r '.data.token')"
  fi

  local hbody
  hbody=$(jq -n --arg s "$orgSlug" --arg e "$hrEmail" --arg p "$staffPassword" '{organisationSlug:$s, email:$e, password:$p}')
  call POST "/api/v1/auth/login" "$hbody"
  if ok "Login as hr"; then
    save hrToken "$(echo "$BODY" | jq -r '.data.token')"
  fi

  [[ -n "${managerToken:-}" ]] && { call GET "/api/v1/auth/me" "" managerToken; ok "GET /api/v1/auth/me (manager)"; }
  [[ -n "${hrToken:-}" ]]      && { call GET "/api/v1/auth/me" "" hrToken;      ok "GET /api/v1/auth/me (hr)"; }
}

# ═══════════════════════════════════════════════════════════════════════
# 09 · Invitations
# ═══════════════════════════════════════════════════════════════════════
seg_invitations() {
  header "09 · Invitations"
  if [[ -z "${orgAdminToken:-}" || -z "${teamId:-}" ]]; then
    skip "Invitations" "orgAdminToken/teamId not set — run earlier segments first"
    return
  fi

  local body
  body=$(jq -n --arg e "second-admin-$RUN_ID@acme.example" '{email:$e, roleName:"org_admin"}')
  call POST "/api/v1/invitations" "$body" orgAdminToken
  if ok "POST /api/v1/invitations (invite org_admin — to be accepted)"; then
    save invitationToken "$(echo "$BODY" | jq -r '.data.invitation.token // .data.token // empty')"
  fi

  # A second, separate invite for the revoke test below — revoking the SAME
  # invite we're about to accept would just be testing the (correct) guard
  # that blocks revoking an already-accepted invitation, not the happy path.
  local body2
  body2=$(jq -n --arg e "third-admin-$RUN_ID@acme.example" '{email:$e, roleName:"org_admin"}')
  call POST "/api/v1/invitations" "$body2" orgAdminToken
  if ok "POST /api/v1/invitations (invite org_admin — to be revoked)"; then
    save invitationId "$(echo "$BODY" | jq -r '.data.invitation.id')"
  fi

  call GET "/api/v1/invitations" "" orgAdminToken
  ok "GET /api/v1/invitations"

  if [[ -n "${invitationToken:-}" && "${invitationToken}" != "null" ]]; then
    local abody
    abody=$(jq -n --arg t "$invitationToken" '{token:$t, password:"password123", firstName:"Second", lastName:"Admin"}')
    call POST "/api/v1/invitations/accept" "$abody"
    ok "POST /api/v1/invitations/accept"
  else
    skip "POST /api/v1/invitations/accept" "no raw token in the invite response — check invitations.controller.js's response shape and adjust the jq path above"
  fi

  if [[ -n "${invitationId:-}" ]]; then
    call POST "/api/v1/invitations/${invitationId}/revoke" "" orgAdminToken
    ok "POST /api/v1/invitations/:id/revoke"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 10 · Users / Employees (incl. a permission negative-test)
# ═══════════════════════════════════════════════════════════════════════
seg_users() {
  header "10 · Users / Employees"
  if [[ -z "${orgAdminToken:-}" ]]; then
    skip "Users" "orgAdminToken not set"
    return
  fi

  call GET "/api/v1/users" "" orgAdminToken
  ok "GET /api/v1/users"

  if [[ -n "${teamId:-}" ]]; then
    call GET "/api/v1/users?teamId=${teamId}" "" orgAdminToken
    ok "GET /api/v1/users?teamId=:id"
  fi

  if [[ -n "${hrUserId:-}" ]]; then
    call GET "/api/v1/users/${hrUserId}" "" orgAdminToken
    ok "GET /api/v1/users/:id"

    if [[ -n "${hrToken:-}" ]]; then
      call PATCH "/api/v1/users/${hrUserId}" '{"phone":"+91-9999999999"}' hrToken
      ok "PATCH /api/v1/users/:id (self-edit)"
    fi

    if [[ -n "${managerToken:-}" ]]; then
      call PATCH "/api/v1/users/${hrUserId}" '{"firstName":"Hacked"}' managerToken
      expect_status "403" "PATCH /api/v1/users/:id (manager editing someone else — should be forbidden)"
    fi

    call PATCH "/api/v1/users/${hrUserId}/status" '{"status":"suspended"}' orgAdminToken
    ok "PATCH /api/v1/users/:id/status (suspend)"

    call PATCH "/api/v1/users/${hrUserId}/status" '{"status":"active"}' orgAdminToken
    ok "PATCH /api/v1/users/:id/status (reactivate)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 11 · Clients
# ═══════════════════════════════════════════════════════════════════════
seg_clients() {
  header "11 · Clients"
  if [[ -z "${orgAdminToken:-}" || -z "${teamId:-}" ]]; then
    skip "Clients" "orgAdminToken/teamId not set"
    return
  fi

  if [[ -z "${clientId:-}" ]]; then
    local body
    body=$(jq -n --arg teamId "$teamId" '{
      companyName:"Beta Corp", ownerTeamId:$teamId, industry:"Software",
      website:"https://betacorp.example", contactName:"Chris Contact",
      contactEmail:"chris@betacorp.example", contactPhone:"+91-9000000000",
      sharedOrgWide:false
    }')
    call POST "/api/v1/clients" "$body" orgAdminToken
    if ok "POST /api/v1/clients (create)"; then
      save clientId "$(echo "$BODY" | jq -r '.data.client.id')"
    fi
  else
    echo "    (using cached clientId=$clientId)"
  fi

  call GET "/api/v1/clients" "" orgAdminToken
  ok "GET /api/v1/clients"

  if [[ -n "${managerToken:-}" && -n "${teamId:-}" ]]; then
    call GET "/api/v1/clients?teamId=${teamId}" "" managerToken
    ok "GET /api/v1/clients?teamId=:id (as manager)"
  fi

  if [[ -n "${clientId:-}" ]]; then
    call GET "/api/v1/clients/${clientId}" "" orgAdminToken
    ok "GET /api/v1/clients/:id"

    call PATCH "/api/v1/clients/${clientId}" '{"status":"active"}' orgAdminToken
    ok "PATCH /api/v1/clients/:id"

    if [[ -n "${teamId2:-}" ]]; then
      local sbody
      sbody=$(jq -n --arg t "$teamId2" '{teamId:$t, canWrite:false}')
      call POST "/api/v1/clients/${clientId}/share" "$sbody" orgAdminToken
      ok "POST /api/v1/clients/:id/share"
    fi
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 12 · Candidates
# ═══════════════════════════════════════════════════════════════════════
seg_candidates() {
  header "12 · Candidates"
  if [[ -z "${hrToken:-}" || -z "${teamId:-}" ]]; then
    skip "Candidates" "hrToken/teamId not set — run: $0 staff_login teams"
    return
  fi

  if [[ -z "${candidateId:-}" ]]; then
    local body
    body=$(jq -n --arg teamId "$teamId" '{
      firstName:"Cara", lastName:"Candidate", ownerTeamId:$teamId,
      email:"cara.candidate@example.com", phone:"+91-9111111111",
      source:"manual", skills:["node.js","postgres"]
    }')
    call POST "/api/v1/candidates" "$body" hrToken
    if ok "POST /api/v1/candidates (create)"; then
      save candidateId "$(echo "$BODY" | jq -r '.data.candidate.id')"
    fi
  else
    echo "    (using cached candidateId=$candidateId)"
  fi

  call GET "/api/v1/candidates" "" hrToken
  ok "GET /api/v1/candidates"

  if [[ -n "${candidateId:-}" ]]; then
    call GET "/api/v1/candidates/${candidateId}" "" hrToken
    ok "GET /api/v1/candidates/:id"

    call PATCH "/api/v1/candidates/${candidateId}" '{"status":"active","notes":"Strong backend candidate"}' hrToken
    ok "PATCH /api/v1/candidates/:id"

    if [[ -n "${teamId2:-}" && -n "${orgAdminToken:-}" ]]; then
      local abody
      abody=$(jq -n --arg t "$teamId2" '{teamId:$t, canWrite:false}')
      call POST "/api/v1/candidates/${candidateId}/access" "$abody" orgAdminToken
      ok "POST /api/v1/candidates/:id/access"
    fi
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 13 · Workflow Templates + Stages
# ═══════════════════════════════════════════════════════════════════════
seg_workflows() {
  header "13 · Workflow Templates"
  if [[ -z "${orgAdminToken:-}" || -z "${teamId:-}" ]]; then
    skip "Workflows" "orgAdminToken/teamId not set"
    return
  fi

  if [[ -z "${workflowTemplateId:-}" ]]; then
    local body
    body=$(jq -n --arg teamId "$teamId" '{name:"Standard Hiring Pipeline", teamId:$teamId, description:"Default pipeline"}')
    call POST "/api/v1/workflows" "$body" orgAdminToken
    if ok "POST /api/v1/workflows (create template)"; then
      save workflowTemplateId "$(echo "$BODY" | jq -r '.data.template.id')"
    fi
  else
    echo "    (using cached workflowTemplateId=$workflowTemplateId)"
  fi

  if [[ -z "${workflowTemplateId:-}" ]]; then
    skip "Stages / everything downstream" "workflowTemplateId still empty — check the jq path in this segment against the real response shape"
    return
  fi

  call GET "/api/v1/workflows" "" hrToken
  ok "GET /api/v1/workflows"

  call GET "/api/v1/workflows/${workflowTemplateId}" "" hrToken
  ok "GET /api/v1/workflows/:id"

  if [[ -z "${stageId:-}" ]]; then
    call POST "/api/v1/workflows/${workflowTemplateId}/stages" '{"name":"Applied","stageKey":"applied","orderIndex":0}' orgAdminToken
    if ok "POST .../stages (Applied)"; then
      save stageId "$(echo "$BODY" | jq -r '.data.stage.id')"
    fi
  fi
  if [[ -z "${stageId2:-}" ]]; then
    call POST "/api/v1/workflows/${workflowTemplateId}/stages" '{"name":"Interview","stageKey":"interview","orderIndex":1,"requiresApproval":false}' orgAdminToken
    if ok "POST .../stages (Interview)"; then
      save stageId2 "$(echo "$BODY" | jq -r '.data.stage.id')"
    fi
  fi
  call POST "/api/v1/workflows/${workflowTemplateId}/stages" '{"name":"Offer","stageKey":"offer","orderIndex":2,"isFinalSuccess":true}' orgAdminToken
  ok "POST .../stages (Offer)"

  call GET "/api/v1/workflows/${workflowTemplateId}/stages" "" hrToken
  ok "GET .../stages"
}

# ═══════════════════════════════════════════════════════════════════════
# 14 · Job Postings
# ═══════════════════════════════════════════════════════════════════════
seg_job_postings() {
  header "14 · Job Postings"
  local missing
  if ! missing=$(need hrToken teamId clientId workflowTemplateId); then
    skip "Job postings" "$missing not set — run: $0 staff_login teams clients workflows"
    return
  fi

  if [[ -z "${jobPostingId:-}" ]]; then
    local body
    body=$(jq -n --arg teamId "$teamId" --arg clientId "$clientId" --arg wt "$workflowTemplateId" '{
      title:"Backend Engineer", description:"Build and maintain our core services.",
      teamId:$teamId, clientId:$clientId, workflowTemplateId:$wt,
      location:"Remote", workMode:"remote", employmentType:"full_time",
      salaryMin:800000, salaryMax:1500000, salaryCurrency:"INR",
      requiredSkills:["node.js","postgres"], vacancies:2
    }')
    call POST "/api/v1/job-postings" "$body" hrToken
    if ok "POST /api/v1/job-postings (create)"; then
      save jobPostingId "$(echo "$BODY" | jq -r '.data.jobPosting.id // .data.job.id')"
    fi
  else
    echo "    (using cached jobPostingId=$jobPostingId)"
  fi

  call GET "/api/v1/job-postings" "" hrToken
  ok "GET /api/v1/job-postings"

  if [[ -n "${jobPostingId:-}" ]]; then
    call GET "/api/v1/job-postings/${jobPostingId}" "" hrToken
    ok "GET /api/v1/job-postings/:id"

    call PATCH "/api/v1/job-postings/${jobPostingId}" '{"vacancies":3}' hrToken
    ok "PATCH /api/v1/job-postings/:id"

    call POST "/api/v1/job-postings/${jobPostingId}/publish" "" hrToken
    ok "POST /api/v1/job-postings/:id/publish"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 15 · Applications (candidate pipeline)
# ═══════════════════════════════════════════════════════════════════════
seg_applications() {
  header "15 · Applications"
  local missing
  if ! missing=$(need hrToken candidateId jobPostingId teamId workflowTemplateId); then
    skip "Applications" "$missing not set — run: $0 candidates job_postings"
    return
  fi

  if [[ -z "${applicationId:-}" ]]; then
    local body
    body=$(jq -n --arg c "$candidateId" --arg j "$jobPostingId" --arg t "$teamId" --arg w "$workflowTemplateId" '{
      candidateId:$c, jobPostingId:$j, teamId:$t, workflowTemplateId:$w, entrySource:"direct"
    }')
    call POST "/api/v1/applications" "$body" hrToken
    if ok "POST /api/v1/applications (create)"; then
      save applicationId "$(echo "$BODY" | jq -r '.data.application.id')"
    fi
  else
    echo "    (using cached applicationId=$applicationId)"
  fi

  call GET "/api/v1/applications" "" hrToken
  ok "GET /api/v1/applications"

  if [[ -n "${applicationId:-}" ]]; then
    call GET "/api/v1/applications/${applicationId}" "" hrToken
    ok "GET /api/v1/applications/:id"

    if [[ -n "${stageId2:-}" ]]; then
      local abody
      abody=$(jq -n --arg s "$stageId2" '{nextStageId:$s}')
      call POST "/api/v1/applications/${applicationId}/advance" "$abody" hrToken
      ok "POST /api/v1/applications/:id/advance"
    fi

    call GET "/api/v1/applications/${applicationId}/history" "" hrToken
    if ok "GET /api/v1/applications/:id/history"; then
      local logId
      logId=$(echo "$BODY" | jq -r '(.data.history // .data.logs // .data)[0].id // empty')
      [[ -n "$logId" ]] && save logId "$logId"
    fi

    if [[ -n "${logId:-}" ]]; then
      call POST "/api/v1/applications/${applicationId}/stages/${logId}/actions" \
        '{"actionType":"note","content":"Left a voicemail, following up tomorrow."}' hrToken
      ok "POST /api/v1/applications/:id/stages/:logId/actions"
    fi

    call POST "/api/v1/applications/${applicationId}/hold" "" hrToken
    ok "POST /api/v1/applications/:id/hold"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 16 · Performance (KPIs / reviews / goals / strategy)
# ═══════════════════════════════════════════════════════════════════════
seg_performance() {
  header "16 · Performance"
  if [[ -z "${managerToken:-}" || -z "${teamId:-}" ]]; then
    skip "Performance" "managerToken/teamId not set"
    return
  fi

  if [[ -z "${kpiId:-}" ]]; then
    local body
    body=$(jq -n --arg t "$teamId" '{name:"Placements per month", teamId:$t, category:"output",
      unit:"count", frequency:"monthly", targetValue:5, direction:"higher_better"}')
    call POST "/api/v1/performance/kpis" "$body" managerToken
    if ok "POST /api/v1/performance/kpis (create)"; then
      save kpiId "$(echo "$BODY" | jq -r '.data.kpi.id')"
    fi
  fi
  call GET "/api/v1/performance/kpis" "" hrToken
  ok "GET /api/v1/performance/kpis"
  if [[ -n "${kpiId:-}" ]]; then
    local ebody
    ebody=$(jq -n --arg k "$kpiId" --arg t "$teamId" '{kpiId:$k, teamId:$t, value:4, periodLabel:"2026-09"}')
    call POST "/api/v1/performance/kpi-entries" "$ebody" hrToken
    ok "POST /api/v1/performance/kpi-entries"
  fi

  if [[ -z "${reviewId:-}" && -n "${hrUserId:-}" ]]; then
    local rbody
    rbody=$(jq -n --arg t "$teamId" --arg r "$hrUserId" '{teamId:$t, revieweeId:$r, cycle:"2026-Q3", summary:"Solid quarter."}')
    call POST "/api/v1/performance/reviews" "$rbody" managerToken
    if ok "POST /api/v1/performance/reviews (create)"; then
      save reviewId "$(echo "$BODY" | jq -r '.data.review.id')"
    fi
  fi
  call GET "/api/v1/performance/reviews" "" hrToken
  ok "GET /api/v1/performance/reviews"

  if [[ -z "${goalId:-}" && -n "${hrUserId:-}" ]]; then
    local gbody
    gbody=$(jq -n --arg t "$teamId" --arg a "$hrUserId" '{teamId:$t, title:"Fill 5 open reqs", assignedTo:$a, progressPct:0}')
    call POST "/api/v1/performance/goals" "$gbody" managerToken
    if ok "POST /api/v1/performance/goals (create)"; then
      save goalId "$(echo "$BODY" | jq -r '.data.goal.id')"
    fi
  fi
  call GET "/api/v1/performance/goals" "" hrToken
  ok "GET /api/v1/performance/goals"

  if [[ -z "${strategyId:-}" && -n "${orgAdminToken:-}" ]]; then
    local sbody
    sbody=$(jq -n --arg t "$teamId" '{teamId:$t, title:"Q4 hiring push", period:"2026-Q4", status:"active"}')
    call POST "/api/v1/performance/strategies" "$sbody" orgAdminToken
    if ok "POST /api/v1/performance/strategies (create)"; then
      save strategyId "$(echo "$BODY" | jq -r '.data.strategy.id')"
    fi
  fi
  call GET "/api/v1/performance/strategies" "" managerToken
  ok "GET /api/v1/performance/strategies"
}

# ═══════════════════════════════════════════════════════════════════════
# 17 · Credits
# ═══════════════════════════════════════════════════════════════════════
seg_credits() {
  header "17 · Credits"
  if [[ -z "${orgAdminToken:-}" ]]; then
    skip "Credits" "orgAdminToken not set"
    return
  fi
  call GET "/api/v1/credits/costs" "" orgAdminToken
  ok "GET /api/v1/credits/costs"
  call GET "/api/v1/credits/balance" "" orgAdminToken
  ok "GET /api/v1/credits/balance"
  call GET "/api/v1/credits/transactions?limit=20&offset=0" "" orgAdminToken
  ok "GET /api/v1/credits/transactions"

  if [[ -n "${platformOwnerToken:-}" ]]; then
    local tbody
    tbody=$(jq -n '{amount:100, description:"e2e test top-up"}')
    call POST "/api/v1/credits/top-up" "$tbody" platformOwnerToken
    # NOT a bug in this script or the backend — documenting real, current
    # behavior: topUp/adjust operate on req.tenantId (the CALLER's own org),
    # not a target org id from the body (topUpSchema has no such field at
    # all). Only platform_admin/platform_owner hold credit_account:write,
    # and their own tenant is the internal 'jopup-platform' org — which
    # isn't a billable customer and has no credit account row — so this
    # 404 is the expected, correct result of how the route is designed
    # today. There is currently NO way to top up a real customer org's
    # credits through this API. Worth a product decision (should top-up
    # accept a target organisationId?), not a code fix applied here.
    expect_status "404" "POST /api/v1/credits/top-up (platform_owner's own org has no credit account — see NOTE in script)"
  else
    skip "POST /api/v1/credits/top-up" "platformOwnerToken not set — run: $0 owner"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# 18 · Job Portal (public)
# ═══════════════════════════════════════════════════════════════════════
seg_job_portal() {
  header "18 · Job Portal (public)"
  if [[ -z "${orgSlug:-}" ]]; then
    skip "Job portal" "orgSlug not set — run: $0 org_signup"
    return
  fi
  call GET "/api/v1/portal/${orgSlug}"
  ok "GET /api/v1/portal/:orgSlug"

  call GET "/api/v1/portal/${orgSlug}/jobs"
  ok "GET /api/v1/portal/:orgSlug/jobs"

  if [[ -n "${jobPostingId:-}" ]]; then
    call GET "/api/v1/portal/${orgSlug}/jobs/${jobPostingId}"
    ok "GET /api/v1/portal/:orgSlug/jobs/:id"

    local abody
    abody=$(jq -n --arg j "$jobPostingId" '{jobPostingId:$j, firstName:"Percy", lastName:"Portal",
      email:"percy.portal@example.com", phone:"+91-9222222222"}')
    call POST "/api/v1/portal/${orgSlug}/apply" "$abody"
    ok "POST /api/v1/portal/:orgSlug/apply (guest apply)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# Dispatch
# ═══════════════════════════════════════════════════════════════════════
ALL_SEGMENTS=(health plans owner platform_admins org_signup org_admin_login teams
              staff_register staff_login invitations users clients candidates
              workflows job_postings applications performance credits job_portal)

usage() {
  cat <<EOF
Usage: $0 [segment ...]

  (no args)      run every segment, in order
  reset          delete saved state (${STATE_FILE}) and exit
  list           print segment names and exit
  <segment> ...  run only the named segment(s), in the order given

Segments:
  ${ALL_SEGMENTS[*]}

Env vars:
  BASE_URL                  default: http://localhost:3000
  PLATFORM_OWNER_EMAIL      needed only for: owner, platform_admins, credits' top-up check
  PLATFORM_OWNER_PASSWORD
EOF
}

case "${1:-}" in
  reset) rm -f "$STATE_FILE"; echo "Cleared $STATE_FILE"; exit 0 ;;
  list|-h|--help) usage; exit 0 ;;
esac

if [[ -z "${RUN_ID:-}" ]]; then
  save RUN_ID "$(date +%s)"
fi
echo -e "${BOLD}JopUP E2E test run — RUN_ID=$RUN_ID, BASE_URL=$BASE_URL, STATE_FILE=$STATE_FILE${NC}"

if [[ $# -eq 0 ]]; then
  TO_RUN=("${ALL_SEGMENTS[@]}")
else
  TO_RUN=("$@")
fi

for seg in "${TO_RUN[@]}"; do
  # Re-source before every segment (not just once at top): a variable a
  # prior segment declared with `local` and then passed to save() only
  # updates that function's own local scope (bash dynamic scoping) — it
  # never becomes a durable global, so a sibling segment in the *same* run
  # can't see it any other way. The state file itself is always correct
  # (save() writes it unconditionally); this just re-reads it fresh so
  # in-process segment-to-segment chaining works, not only across separate
  # script invocations.
  # shellcheck disable=SC1090
  source "$STATE_FILE" 2>/dev/null || true
  if declare -f "seg_${seg}" > /dev/null; then
    "seg_${seg}"
  else
    echo -e "${RED}Unknown segment: $seg${NC}"
    usage
    exit 1
  fi
done

echo
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}PASS: $PASS_COUNT${NC}   ${RED}FAIL: $FAIL_COUNT${NC}   ${YELLOW}SKIP: $SKIP_COUNT${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
[[ "$FAIL_COUNT" -eq 0 ]]
