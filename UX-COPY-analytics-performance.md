## UX Copy: Analytics and Performance pages

Voice: plain, warm, specific. Recruiters read this on a phone between calls, so labels are short and every empty state says what to do next. Errors follow *what happened + why + how to fix*.

### Recommended copy

**Analytics**
- Page: **Analytics** — "How your pipeline is converting, and where candidates get stuck."
- Stat tiles: **In pipeline** · **Placed** ("38% of closed candidates") · **Positions filled** ("12/30") · **Avg. time in stage** ("2 stuck over 5 days")
- Funnel hint: "Candidates who reached each stage or went beyond it. Percentages compare with the stage above."
- Empty (no data): **No candidates in this view yet** — "Tag candidates to an open position and their progress will show up here. Try a longer time range if you expected data."
- Empty (recruiters): **No assigned recruiters yet** — "Assign candidates to a recruiter to compare workloads and placements."
- Empty (positions): **Every open position is filled** — "New open positions with vacancies will appear here."
- Loading: "Crunching your pipeline…"

**Performance**
- Page: **Performance** — "Track targets, goals and reviews for your team."
- Tabs: **KPIs · Goals · Reviews · Strategy**
- KPI health labels: On target / Slightly behind / Behind target · On target / Slightly over / Over target (for lower-is-better) · No target set · No data yet
- Trend: "12% vs last period"
- CTAs: **Add a KPI**, **Record value**, **Save value**, **Set a goal**, **Update progress**, **Mark as completed**, **Start a review**, **Save draft**, **Submit review**, **Acknowledge**, **Add an objective**
- Empty states
  - KPIs (manager): **No KPIs yet** — "Add the numbers your team is measured on, then record a value each period to see trends."
  - KPIs (HR): **No KPIs yet** — "Your manager hasn't set up any KPIs for your team yet."
  - Goals: **No goals yet** — "Set a goal for your team or a teammate and track progress toward it."
  - Reviews: **No reviews yet** — "Start a review for a team member. Drafts stay private until you submit them."
  - Strategy: **No strategy for this period** — "Write an objective with measurable key results so the team knows what success looks like."
- Form helpers: Period → "Shown on the trend, e.g. "March 2026" or "W12 2026"." · Assign to → "Leave "Assign to" empty to make it a team goal." · Private notes → "Only managers can see these."
- Review sheet intro: "It's saved as a draft. The person can't see it until you submit it."
- Validation (inline, one fix per message)
  - "Enter a number for this period's value."
  - "Give this KPI a name, e.g. "Placements per month"."
  - "Choose which team this KPI belongs to."
  - "Add the review period, e.g. "Q3 2026"."
  - "Every key result needs a numeric target."
- Save failures: "We couldn't save this value. Check your connection and try again." (same pattern: "…create this KPI / save this goal / update this review / save this review…")
- No access: **You don't have access to performance data yet** — "Ask your organisation admin to enable it for your role."
- No team: **You're not on a team yet** — "Performance data is organised by team. Once an admin adds you to one, it will show up here."

### Messages that now come from the API (written to match this voice)
- 404 for another team's data reads as "KPI not found", "Review not found": it never says the item exists elsewhere.
- Duplicate review: "There's already a review for Q2 2026. Open it instead of starting another"
- Edit after submit: "This review has been submitted and can no longer be edited"
- Self review: "You can't write a review of yourself"
- Empty review: "Add at least one score or a summary before submitting"
- Switched-off KPI: "This KPI is switched off. Turn it back on to record values"
- Plan without the module: "Module 'kpi_engine' is not enabled for your subscription plan" (recommended UI wording, not wired yet: "Performance isn't part of your current plan. Ask your admin about upgrading." The pages currently show the API message)
- Re-recording a period: the sheet says "Recording the same period again replaces the earlier value." The save succeeds with no extra toast.

### Alternatives
| Option | Copy | Tone | Best for |
|---|---|---|---|
| A | "Behind target" | Neutral, factual | Default KPI status (used) |
| B | "Needs attention" | Action-oriented | Manager dashboards where the next step matters more than the gap |
| C | "Off track" | Blunt | Weekly digest emails |
| A | "Submit review" | Direct | Draft → visible to reviewee (used) |
| B | "Share with {name}" | Personal | If you want managers to feel the consequence of the click |
| A | "Reached" for Turn-up | Matches recruiter chat | Copied/emailed text only. The UI keeps "Turn-up" |

### Rationale
- Verb-first, specific CTAs ("Record value", not "Submit") so the label matches the outcome.
- "Behind target" and "Slightly behind" describe the numbers without judging the person; reviews carry the people-sensitive wording.
- Empty states always say what the screen is, why it's empty, and the first step. HR users get a different line from managers because they can't create KPIs; a "Create" button they can't use would be noise.
- The draft/submit distinction is stated twice (sheet intro + button) because submitting is the moment a review becomes visible to the person reviewed.
- Funnel wording says "reached or beyond" because the list endpoint only returns each candidate's current stage, so it is an approximation, not a true cohort funnel.

### Localization notes
- Period labels ("March 2026", "W12 2026", "Q3 2026") are user-typed and en-IN formatted by default; avoid translating them automatically.
- "Turn-up" and "Lineup" are recruiter jargon with no clean equivalent in some languages; keep a glossary entry. "Reached" (used in client mails) is an idiom for "turned up".
- Percent/₹ formatting uses `en-IN`; "12/30" style fractions are locale-neutral.
- Expect ~30% growth in German/Hindi; the tab labels and the 5.5rem funnel label column are the tightest spots.
