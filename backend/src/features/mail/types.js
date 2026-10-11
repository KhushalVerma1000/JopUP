/**
 * The registry of client tracker mails HR can send from the Email Tracker tab.
 *
 * One entry per kind of mail. An entry says three things: who the audience is,
 * what HR must pick before the mail can be built (`needs`), and how the mail is
 * built (which candidates, which default columns, what it is called). Adding a
 * new kind of mail is a new entry here, not new screens or new endpoints.
 *
 *   needs      the picker steps, in order: 'client' → 'location' → 'date'
 *   dateField  the tracker date the 'date' step filters on ('lineupDate' | 'interviewDate')
 *   stages     only candidates currently in one of these stages (stageKey); omit = any
 *   statuses   tracker statuses included; the default is the live pipeline
 *   columns    default columns when neither the location nor a manager template sets any
 *   trackerType  which saved templates are offered first for this mail
 *
 * Every entry here is a mail to a CLIENT: one client per mail, never mixed
 * (see clientScope.js). Internal reports and candidate reminders follow the
 * same shape later, with `audience` set accordingly.
 */
const LIVE = ['active', 'on_hold'];

const TYPES = [
  {
    key: 'lineup', label: 'Lineup', audience: 'client', trackerType: 'interview_tracker',
    blurb: 'Who is coming to the client on a day',
    needs: ['client', 'location', 'date'], dateField: 'lineupDate', statuses: LIVE,
    columns: ['candidate_name', 'mobile', 'position', 'location', 'lineup_time'],
    intro: 'Please find the lineup below.',
  },
  {
    key: 'interview_schedule', label: 'Interview schedule', audience: 'client', trackerType: 'interview_tracker',
    blurb: 'Interviews fixed for a day',
    needs: ['client', 'location', 'date'], dateField: 'interviewDate', statuses: LIVE,
    columns: ['candidate_name', 'mobile', 'position', 'interview_date', 'interview_time'],
    intro: 'Please find the interview schedule below.',
  },
  {
    key: 'submission', label: 'Profiles submitted', audience: 'client', trackerType: 'submission_tracker',
    blurb: 'Candidate profiles shared with the client',
    needs: ['client', 'location'], statuses: LIVE,
    columns: ['candidate_name', 'position', 'location', 'cf:experience', 'cf:current_ctc', 'cf:expected_ctc', 'cf:notice_period'],
    intro: 'Please find the profiles below for your review.',
  },
  {
    key: 'status', label: 'Status update', audience: 'client', trackerType: 'status_tracker',
    blurb: 'Where every candidate stands right now',
    needs: ['client', 'location'], statuses: LIVE,
    columns: ['candidate_name', 'position', 'location', 'stage', 'status_note'],
    intro: 'Please find the latest status below.',
  },
  {
    key: 'offer', label: 'Offers', audience: 'client', trackerType: 'offer_tracker',
    blurb: 'Candidates at the offer stage',
    needs: ['client', 'location'], stages: ['offer'], statuses: LIVE,
    columns: ['candidate_name', 'mobile', 'position', 'location', 'stage', 'status_note'],
    intro: 'Please find the offer tracker below.',
  },
  {
    key: 'joining', label: 'Joinings', audience: 'client', trackerType: 'joining_tracker',
    blurb: 'Candidates who have joined',
    needs: ['client', 'location'], stages: ['joined'], statuses: [...LIVE, 'placed'],
    columns: ['candidate_name', 'mobile', 'position', 'location', 'stage'],
    intro: 'Please find the joining tracker below.',
  },
];

const BY_KEY = new Map(TYPES.map((t) => [t.key, t]));
const get = (key) => BY_KEY.get(key) || null;
const isKnownType = (key) => BY_KEY.has(key);

/** What the screen needs (no internals): enough to draw the "What are you sending?" cards. */
const describe = () => TYPES.map(({ key, label, audience, blurb, needs, trackerType }) => ({ key, label, audience, blurb, needs, trackerType }));

module.exports = { TYPES, get, isKnownType, describe };
