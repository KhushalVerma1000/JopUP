# Patch: UI shell — phone "More" menu, better sheets (desktop + phone)

Frontend only. Full files, extract with -Force. No backend, no migration.

## Changed (frontend/src/)
- components/AppLayout.jsx      Phone tab bar never hides a screen. Up to 5 screens show as tabs; with more, 4 tabs + "More".
                                "More" opens a sheet with the rest, your name/role and Sign out. Phone header is now just brand + avatar.
- components/common/index.jsx   Sheet: grab bar on phones, title + close stay pinned while the form scrolls, new `size` prop (md | lg | xl).
- components/hr/TrackerMailSheet.jsx       size="xl" — the Excel-style table gets room on desktop.
- components/managerial/TemplatesTab.jsx   size="lg" — column picker has room on desktop.

## Fixes a real bug
Org admins have 6 tab-bar screens (Home, Team, Pipeline, Clients, People, Settings). The old bar sliced to 5, so Settings was unreachable on a phone.

## Checked / not checked
- vite build passes; oxlint 0 errors (same 33 existing warnings).
- Not tried in a browser or on a phone.

## HR workbench cards (added in this patch)
- Main button names the action: "Schedule Interview →", "Mark Reached →", "Make Offer →"… (src/lib/stageVerbs.js, keyed by stageKey; custom stages fall back to "Move to <name>").
- New "⋯" button opens an actions sheet: Choose Another Stage…, Put on Hold, Reject… (only what the role may do). Replaces the two small icon buttons.
- New segmented stage-progress bar on each active card (components/hr/StageProgress.jsx), built from the candidate's own workflow.
- New files: lib/stageVerbs.js, components/hr/StageProgress.jsx, components/hr/CandidateActionsSheet.jsx. Changed: pages/HrPage.jsx.
- Not in this patch: the desktop table view from the mockups (cards still used on desktop).
