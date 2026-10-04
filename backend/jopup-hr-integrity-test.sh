#!/usr/bin/env bash
###############################################################################
# JopUP — HR workbench integrity checks (concurrency + team scoping)
#
# Regression guard for the bugs fixed in the HR workbench patch:
#   1. Simultaneous stage moves left one candidate open in several stages.
#   2. Simultaneous first-time tagging created several default workflows.
#   3. Simultaneous identical tag requests created duplicate live tags.
#   4. HR users could read / modify other teams' candidates and positions.
#
#   docker compose exec backend bash jopup-hr-integrity-test.sh
#
# Needs the demo data:  npm run db:seed && npm run db:seed:demo
# Requires: curl, jq.   Config: BASE_URL (default http://localhost:3000)
###############################################################################
set -uo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
API="$BASE_URL/api/v1"
PASS=0; FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

ok()   { PASS=$((PASS+1)); echo -e "  ${GREEN}✔${NC} $1"; }
bad()  { FAIL=$((FAIL+1)); echo -e "  ${RED}✘${NC} $1  (${2:-})"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected $3, got $2"; fi; }

login() { curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Password123!\"}" | jq -r '.data.token'; }
get()   { curl -s "$API$1" -H "authorization: Bearer $2"; }
post()  { curl -s -X POST "$API$1" -H "authorization: Bearer $2" -H 'content-type: application/json' -d "${3:-{\}}"; }

HR=$(login hr.tech@acme.test); SALES=$(login hr.sales@acme.test); ADMIN=$(login admin@acme.test)
for t in "$HR" "$SALES" "$ADMIN"; do
  [ -z "$t" ] || [ "$t" = "null" ] && { echo "Could not log in — run the demo seed first."; exit 2; }
done

echo "1. Concurrent stage moves leave exactly one open stage"
TR=$(get /trackers "$HR" | jq -c '[.data.trackers[] | select(.status=="active")][0]')
TID=$(echo "$TR" | jq -r .id); WF=$(echo "$TR" | jq -r .workflowTemplateId)
STAGES=$(get "/workflows/$WF/stages" "$HR" | jq -c '[.data.stages | sort_by(.orderIndex)[] | .id]')
LAST=$(echo "$STAGES" | jq -r '.[-2]')   # last stage before the final-success one
for i in 1 2 3 4; do post "/trackers/$TID/advance" "$HR" "{\"nextStageId\":\"$LAST\"}" >/dev/null & done; wait
OPEN=$(get "/trackers/$TID/history" "$HR" | jq '[.data.history[] | select(.exitedAt == null)] | length')
check "open stage logs after 4 simultaneous moves" "$OPEN" "1"

echo "2. Concurrent first-time tagging creates one default workflow"
TEAM=$(post /teams "$ADMIN" "{\"name\":\"integrity-$RANDOM$RANDOM\"}" | jq -r '.data.team.id')
CANDS=$(get /candidates "$ADMIN" | jq -r '[.data.candidates[0:10][].id] | .[]')
for c in $CANDS; do post /trackers "$ADMIN" "{\"teamId\":\"$TEAM\",\"candidateId\":\"$c\"}" >/dev/null & done; wait
DEFAULTS=$(get /workflows "$ADMIN" | jq --arg t "$TEAM" '[.data.templates[] | select(.teamId==$t and .isDefault)] | length')
check "default workflows for the new team" "$DEFAULTS" "1"

echo "3. Concurrent identical tag requests create one live tag"
POS=$(get /open-positions "$HR" | jq -c '.data.positions[0]'); PID=$(echo "$POS" | jq -r .id); PTEAM=$(echo "$POS" | jq -r .teamId)
LIVE=$(get "/trackers?openPositionId=$PID" "$HR" | jq -r '[.data.trackers[] | select(.status=="active" or .status=="on_hold") | .candidateId] | .[]')
CAND=$(get /candidates "$HR" | jq -r --argjson live "$(echo "$LIVE" | jq -R . | jq -sc .)" '[.data.candidates[] | select(.id as $i | $live | index($i) | not)][0].id')
for i in 1 2 3 4 5; do post /trackers "$HR" "{\"teamId\":\"$PTEAM\",\"candidateId\":\"$CAND\",\"openPositionId\":\"$PID\"}" >/dev/null & done; wait
N=$(get "/trackers?openPositionId=$PID" "$HR" | jq --arg c "$CAND" '[.data.trackers[] | select(.candidateId==$c and (.status=="active" or .status=="on_hold"))] | length')
check "live tags for the same candidate + position" "$N" "1"

echo "4. Team scoping"
SALES_TEAMS=$(get /trackers "$SALES" | jq '[.data.trackers[].teamId] | unique | length')
check "teams visible in a Sales HR's tracker list" "$SALES_TEAMS" "1"
check "Sales HR reading a Tech tracker" "$(get "/trackers/$TID" "$SALES" | jq -r .message)" "Tracker not found"
check "Sales HR moving a Tech tracker" "$(post "/trackers/$TID/hold" "$SALES" | jq -r .message)" "Tracker not found"
check "Sales HR creating a position in Tech's team" \
  "$(post /open-positions "$SALES" "{\"teamId\":\"$PTEAM\",\"designation\":\"x\"}" | jq -r .message)" "You don't have access to that team"

echo; echo "Passed: $PASS   Failed: $FAIL"; [ "$FAIL" -eq 0 ]
