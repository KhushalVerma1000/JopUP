# HR workbench — audit and fixes

Three lenses (design system, system design, UX copy) applied to the previous
HR workbench patch. Every backend finding below was **reproduced against a live
server before it was fixed**, and re-checked after. This zip is a superset of
the two earlier patches (accept-invite, HR workbench) — apply it over them.

## Apply (PowerShell, repo root)

```powershell
Expand-Archive -Path .\jopup-hr-workbench-v2-patch.zip -DestinationPath . -Force

# Zips can't delete files. These are leftovers from before the migration
# consolidation: not in the journal, never applied, but drizzle-kit diffs
# against the newest snapshot, so they make `db:generate` emit a bogus
# "re-create everything" migration.
Remove-Item .\backend\drizzle\migrations\0000_sleepy_northstar.sql
Remove-Item .\backend\drizzle\migrations\0001_confused_peter_parker.sql
Remove-Item .\backend\drizzle\migrations\0002_slippery_starbolt.sql
Remove-Item .\backend\drizzle\migrations\0003_staff_self_registration.sql
Remove-Item .\backend\drizzle\migrations\0004_candidate_created_by_nullable.sql
Remove-Item .\backend\drizzle\migrations\meta\0002_snapshot.json
Remove-Item .\backend\drizzle\migrations\meta\0003_snapshot.json
Remove-Item .\backend\drizzle\migrations\meta\0004_snapshot.json
Remove-Item .\frontend\src\pages\HrClassicPage.jsx   # if not already removed

docker compose up -d        # backend start runs db:migrate (new 0001) then nodemon
docker compose exec backend bash jopup-hr-integrity-test.sh   # needs demo seed
```

Migration `0001_hr_workbench_integrity` adds two partial unique indexes. It
first demotes existing duplicates (oldest row wins; extra live tags become
`withdrawn`, extra default templates stop being default) so it applies cleanly
to a database that already has them.

---

# 1. System design review

**Requirements the patch has to meet:** several HRs work one team's pipeline at
once, on phones, with flaky connectivity (so retries and double-taps are
normal); candidate phone numbers are personal data; "tagged to a position" and
"placed" drive client-facing counts.

| # | Finding | Sev | Evidence | Fix |
|---|---|---|---|---|
| 1 | **Stage moves weren't serialised.** `advance` read the current stage outside its transaction with no lock, so concurrent requests all "moved on" from the same stage. | High | 3 simultaneous advances → 3×200, candidate **open in 3 stages**. | Row lock (`SELECT … FOR UPDATE`) on the tracker inside the transaction; all validation re-read under the lock. Same for hold/block/resume. After: 1 open stage, losers get a clear 409. |
| 2 | **Team scoping was UI-only.** Tracker/position lists returned the whole org; any HR could read other teams' names and phone numbers, or move their candidates, by calling the API. | High | The list returned every tracker in the org to any HR. Now a Tech HR gets only their own team's 7 (the org admin still gets all 76, across 8 teams, in my test DB). Cross-team read/hold/patch/create → 404/403. | `utils/teamScope.js` derives visible teams from the JWT roles (org-level `org_admin` = all; everyone else = teams they hold a role in; fails closed). Applied to every tracker and position route. Out-of-team looks like "not found". |
| 3 | **Stage-action endpoint had no ownership check** (`POST /trackers/:id/stages/:logId/actions`): `logId` was never tied to the tracker, org or team. | High | By inspection: insert on any log id. Now: other org → 404, other team → 404, log from a different tracker → 404. | `addStageAction` verifies tracker (org + team) and that the log belongs to it. |
| 4 | **Parallel first-time tagging created several "default" workflows** for one team, splitting its candidates across templates, violating the schema's own "exactly one default" rule. | Med | 12 parallel tags on a fresh team → 3 default templates (second run). | `wt_one_default_per_team` unique partial index; default pipeline now created template+stages in one transaction (no half-built default is ever visible); loser of the race re-reads the winner's. After: 36 parallel tags over 3 teams → 1 default × 7 stages each. |
| 5 | **Double-tag race.** "Already tagged" was check-then-insert. | Med | 6 simultaneous identical requests → duplicates possible. | `ctr_one_live_tag_uq` partial unique index (live = active/on_hold); unique violation → friendly 409. After: 1×201, 5×409, 1 live row. |
| 6 | **Advance accepted nonsense**: same stage, backwards, or any move on a rejected/placed/held candidate. | Med | Reproduced. | Must be `active`, target after current, same workflow. Messages say what to do ("Pick a stage after Interview"). |
| 7 | Bulk tagging used N parallel POSTs (which is what triggered #4), reported partial failure poorly, and resolved the position/workflow N times. | Med | — | `POST /trackers/tag`: validates the position and resolves the workflow once, one transaction per candidate, returns `{tagged, skipped, failed}`. |
| 8 | `activeCount` loaded every tracker row and counted in JS. | Low | — | One `GROUP BY` query. |
| 9 | Hold → resume dropped the status note ("Reached"). | Low | — | Resume carries the note over. |

**Trade-offs made**
- *Lock vs optimistic version column.* Chose row locks: smaller change, no
  client protocol change, and contention per tracker is tiny. Revisit only if a
  hot tracker ever shows lock waits.
- *Forward-only advance* is a behaviour change. If HR needs to correct a
  mistaken move, add an explicit "move back" action (audited, reason required)
  rather than loosening this endpoint.
- *Team scoping from JWT roles* means a role change applies at next login (the
  same as every other permission today).

**Not fixed — revisit as it grows**
- `GET /candidates` and `/clients` are still org-wide (not team-scoped): same
  class of issue as #2. Decide whether the candidate pool is meant to be shared
  org-wide; if not, scope it the same way (small change now, painful later).
- Lists are unbounded and filtered client-side. Fine for a beta; at roughly
  **a few thousand trackers per org** the pipeline payload and render get slow →
  add `limit`/cursor and load "Closed" lazily.
- Candidate picker loads the whole candidate list; add server-side `?q=` search
  at ~1–2k candidates.
- Tracker status and stage log are written in one transaction, but events/audit
  are written after on other connections; if you ever need exactly-once
  delivery, move to an outbox table.
- Status can only be set while moving stage. HR will want "called — not
  reachable" without moving; the stage-action endpoint is the natural home.

# 2. Design-system audit

**Reviewed:** the new HR surfaces plus the shared primitives they use.
Counts are from the files (previous patch → this patch).

| Pattern | Before | After | Resolution |
|---|---|---|---|
| Hand-written `grid gap-2` + `Label` field wrapper | 17 | 0 | `Field` (label, control, hint) — 17 uses |
| Hard-coded `amber-*` / `emerald-*` colours | 8 | 0 | `Notice` (tones come from the existing `TONES`) — 6 uses |
| Hand-rolled 44px round icon buttons / links | 4 | 0 | `RoundAction` (button or link) — 4 uses |
| Hand-copied floating-button class string | 2 | 0 | `Fab` — 2 uses |
| Copy-pasted input classes on a `<textarea>` | 1 | 0 | `ui/textarea` |
| Decorative icons exposed to screen readers | 3 aria-hidden | 15 | icons marked `aria-hidden` |

| Component | States | A11y | Notes |
|---|---|---|---|
| `Sheet` | ✅ | ⚠️→✅ | Was a labelled dialog but with no focus handling. Now: focus moves in, Tab is trapped, Esc closes only the **top** sheet, scroll lock is taken/released once for nested sheets, focus returns to the opener, `aria-labelledby`/`describedby`, optional `description`. (Found and fixed a focus-restore bug while testing: `autoFocus` fields steal focus before an effect can record the opener.) |
| `Notice` | ✅ | ✅ | `warn`/`bad` → `role=alert`, `info`/`good` → `role=status`. |
| `Field`, `Fab`, `RoundAction` | ✅ | ✅ | Icon-only controls require `aria-label` (documented in the component). |
| `Bar` | ✅ | ⚠️→✅ | Progressbar now has a label and `aria-valuemin`. |
| Picker rows | ✅ | ✅ | `aria-pressed` on the position picker, `role=checkbox` on candidates. |
| `Chips` | ✅ | ⚠️ | **Not changed:** uses tab semantics (`role=tab`) without tab panels; used both as tabs and as filters. Follow-up: `aria-pressed` toggle buttons for filters. |

**Remaining token gaps:** the app has no semantic success/warning tokens (only
`primary/secondary/muted/accent/destructive`), so `TONES` in `common` still
hard-codes palette colours — now in exactly one place. Adding `--success` and
`--warning` to `index.css` would let `TONES` drop them entirely.

**Priority actions**
1. Add `--success`/`--warning` tokens and point `TONES` at them.
2. Move `Clients`, `Teams` and other pages onto `Field`/`Notice`/`Fab` (additive; nothing forces it).
3. Decide `Chips` semantics (tabs vs filters).

# 3. UX copy review

Principles applied: same word for the same thing (**position**, **tag**,
**move**), verbs on buttons, errors say what happened + what to do, empty
states say how to start.

| Where | Before | After | Why |
|---|---|---|---|
| Empty pipeline (mine) | "Nothing assigned to you yet" · "Tap + to add…" | "No candidates assigned to you" · "Add a candidate to start tracking them, or switch to Whole team…" | There is no "+"; the button is labelled. |
| Empty pipeline (team) | "The pipeline is empty" | "No candidates in the pipeline yet" | Says what is empty. |
| Empty stage | "Nobody here" | "No candidates at this stage" | |
| Empty position tabs | "No on hold positions" | "No positions on hold" (also filled / cancelled) | Grammar. |
| Stage sheet title | "Update Rahul" | "Move Rahul Sharma" | Matches the button that opened it. |
| Stage sheet CTA | "Update to Lineup & copy" | "Move to Lineup & copy details" → "Moved & copied ✓" | Says exactly what happens. |
| Preview label | "Will be copied" | "Text to copy" | |
| Status input | "…or type your own" | "Or type your own, e.g. Reached at 3 pm" | Shows the intent. |
| Move failed | "…(Text was copied, but nothing was changed.)" | Server reason + "Nothing was copied." (or "…ignore the text that was just copied." on old browsers) | The old text could put a false update on the clipboard; now it can't (copy happens only after success where the browser allows it). |
| Copy blocked | "…long-press the text above to copy it" | Notice: "Moved to Lineup, but your browser blocked copying" + Done | The move succeeded — say that first. |
| Disabled move | "Final stage" | "No further stages" | |
| Reject | Title + field only | "They'll move to Closed… can't be undone from here." · **Keep in pipeline** / **Reject candidate** | States consequences; labels buttons with actions. Sheet now stays open if the reject fails. |
| Position actions | "Add candidates" · "Pipeline" · "Hold" · "Cancel" | "Tag candidates" · "View pipeline" · "Put on hold" · "Cancel position" | One verb ("tag") everywhere; "Cancel" no longer reads as dismissing a dialog. |
| Full position | — | "All 3 vacancies filled." + **Mark as filled** | Next step surfaced. |
| Duplicate phone | "May already be in your database" · Cancel / Add anyway | "This number is already saved" · **Use Rahul** / **Add as a new candidate** / **Edit number** | Default path avoids creating a duplicate record. |
| Bulk tag result | "3 tagged, 1 failed: …" | "Tagged 3 candidates to X. 1 was already on this position." / "Tagged 2. Couldn't tag 1: …" | |
| Candidate picker CTA | "Select candidates" | "Select candidates to tag" | |
| Position search | "Search role, client or city…" | "Search position, client or city…" | "role" was a third word for the same thing. |
| Post job | silent collapse | "Draft posting created for X. Publish it below when you're ready." (section opens) | Confirms and shows where it went. |
| Tag buttons | "Tag to a position" | "Tag to position" | Consistent with the picker title. |

**Localization notes:** all strings are short and plural-aware only for
"candidate(s)" / "vacancy/vacancies" (use ICU plurals when i18n arrives);
dates still format as `en-IN` in `lib/format`; the copied block's labels
(Name / Mobile / Location / Position / Stage / Status) are English on purpose —
they're pasted into chats.

**Naming mismatch to resolve:** the default workflow seeds "Line-up" and
"Turn up", the demo seed uses "Lineup" (and has no "Turn up"). HR will see
whichever workflow their team has; pick one spelling.

---

## Verification

| Check | Result |
|---|---|
| Backend suite | 81 / 81 pass (7 new since the previous patch: team scope ×5, bulk-tag schema/auth ×2) |
| `jopup-hr-integrity-test.sh` against live server | 7 / 7 |
| UI behaviour (simulated browser): copy-after-success, failure copies nothing, fallback path, copy-blocked path, nested sheets, focus restore | 22 / 22 |
| Frontend production build | passes |
| Migration applied to a DB that already contained duplicates | succeeds; duplicates demoted |
| **Not done** | A real phone/desktop browser pass, and a real Safari clipboard test. The deferred-copy path (`ClipboardItem` with a promise) is the one most worth checking on an iPhone. |
