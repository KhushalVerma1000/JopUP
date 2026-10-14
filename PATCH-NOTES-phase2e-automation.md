# Phase 2E — automation rules (requires jopup-cleanup.zip applied first)

A manager picks "when X happens, move the candidate to stage Y"; the system does it and
writes "Auto: <rule name>" in the stage history.

Triggers: a lineup date set, an interview date set, or any client mail type marked as sent.
Targets: a stage key that exists in your workflows (Line-up, Interview, Offer, ...).

Safety: only moves ACTIVE candidates FORWARD. Never backwards, never twice, never for held /
rejected / withdrawn / placed candidates. A workflow without that stage is skipped. It runs after
HR's own action has succeeded and never fails it. Clearing a date triggers nothing.
"Joined" is not in the suggested rules because reaching it marks a candidate placed.

Where it fires: PATCH /trackers/:id (dates), POST /trackers/bulk/dates, POST /mail/sent.
The response gains an `automation` field ({ rule, moved: [...], skipped }) when a rule ran.

New API (module pipeline_tracker; tracker_templates permission: manager writes, HR reads):
  GET /automation/options  GET|POST /automation/rules  PATCH|DELETE /automation/rules/:id
UI: Settings -> Automation tab (suggested one-tap rules + new rule + on/off + delete).

Migration 0007_automation_rules (one table). Tests: 6 new, full suite 175 pass / 0 fail / 19 skipped.
Verified on a real Postgres with demo data: fresh migrate 0000-0007, rule create / permission (HR gets
403) / duplicate (409) / bad stage (400 with the list), a candidate in Screening moved to Interview on
a single date update, the repeat moved nobody, a bulk date moved 1, disable / delete. NOT live-tested:
the "mail marked as sent" trigger (same run() path; covered by unit tests only).

Apply (PowerShell, repo root, after the cleanup patch):
    Expand-Archive jopup-phase2e-automation.zip -DestinationPath . -Force
    cd backend; npm run db:migrate; cd ..
    git add -A; git commit -m "feat: pipeline automation rules (phase 2E)"
    git push origin dev
