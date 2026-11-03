const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseSheet } = require('../src/features/data-import/analyse');
const { buildPlan, nameKey, similarity, matchName, resolveStage } = require('../src/features/data-import/match');

const NOW = new Date(Date.UTC(2026, 9, 14));
const opts = { defaultCountry: 'IN', now: NOW };
const STAGES = ['applied', 'screening', 'lineup', 'turnup', 'interview', 'offer', 'joined'].map((k, i) => ({ stageKey: k, name: k, orderIndex: (i + 1) * 10 }));

const grid = [
  ['Name', 'Phone', 'Client', 'Position', 'Job Location', 'Lineup Date', 'Status', 'Recruiter'],
  ['Rahul Sharma', 9876543210, 'Reliance Retail Pvt Ltd', 'Store Manager', 'Andheri', '13/10/2026', 'Reached', 'Neha Gupta'],
  ['Priya Verma', 9812345678, 'RELIANCE RETAIL', 'Cashier', 'Andheri', '13/10/2026', 'No show', 'Neha Gupta'],
  ['Amit Singh', 9123456789, 'Tata Trent', 'Sales Executive', 'Pune', '20/10/2026', 'Lined up', 'Someone Else'],
  ['Rahul Sharma', 9876543210, 'Tata Trent', 'Sales Executive', 'Pune', '20/10/2026', 'Lined up', null],
  ['Rahul Sharma', 9876543210, 'Tata Trent', 'Sales Executive', 'Pune', '20/10/2026', 'Lined up', null],
  ['Neha Roy', 9000011111, 'Reliance', 'Cashier', 'Andheri', '13/10/2026', 'Selected', null],
];
const sheets = [analyseSheet({ name: 'S', rows: grid }, opts)];

const catalog = (over = {}) => ({
  clients: [{ id: 'c-rel', companyName: 'Reliance Retail Limited' }, { id: 'c-tata', companyName: 'Tata Trent' }],
  locations: [{ id: 'l-and', clientId: 'c-rel', name: 'Andheri West', aliases: ['Andheri'] }],
  positions: [{ id: 'p-cash', clientId: 'c-rel', designation: 'Cashier', location: 'Andheri', status: 'open' },
    { id: 'p-old', clientId: 'c-rel', designation: 'Store Manager', location: 'Andheri', status: 'cancelled' }],
  users: [{ id: 'u-neha', firstName: 'Neha', lastName: 'Gupta', email: 'neha@acme.in' }, { id: 'u-me', firstName: 'Imp', lastName: 'Orter', email: 'i@acme.in' }],
  candidates: [{ id: 'k-priya', firstName: 'Priya', lastName: 'Verma', email: null, phone: '9812345678', phoneNormalized: '+919812345678' }],
  liveTags: [],
  stages: STAGES,
  permissions: {},
  ...over,
});
const plan = (over = {}, decisions = {}) => buildPlan({ sheets, catalog: catalog(over), decisions, opts: { now: NOW } });

test('names: company suffixes and case do not matter, near names are only near', () => {
  assert.equal(nameKey('Reliance Retail Pvt. Ltd.'), nameKey('RELIANCE RETAIL LIMITED'));
  assert.equal(nameKey('Procter & Gamble'), nameKey('Procter and Gamble'));
  assert.ok(similarity('gurgaon', 'gurugram') < 0.8);
  const opts2 = [{ id: 1, key: 'reliance retail', label: 'Reliance Retail' }, { id: 2, key: 'tata trent', label: 'Tata Trent' }];
  assert.equal(matchName('reliance retail', opts2).type, 'exact');
  assert.equal(matchName('reliance', opts2).type, 'near');
  assert.equal(matchName('tata trnt', opts2).type, 'near');
  assert.equal(matchName('infosys', opts2).type, 'none');
  assert.equal(matchName('x', [{ id: 1, key: 'x', label: 'a' }, { id: 2, key: 'x', label: 'b' }]).type, 'ambiguous');
});

test('stages: a missing stage falls back to the nearest earlier one, and says so', () => {
  const noTurnup = STAGES.filter((s) => s.stageKey !== 'turnup');
  assert.deepEqual(resolveStage('turnup', noTurnup), { stageKey: 'lineup', missing: true, wanted: 'turnup' });
  assert.deepEqual(resolveStage('interview', STAGES), { stageKey: 'interview', missing: false });
  assert.equal(resolveStage(null, STAGES).stageKey, 'applied');
});

test('clients: exact (despite Pvt Ltd / case) is used; a short form is only suggested', () => {
  const { entities } = plan();
  const rel = entities.clients.find((c) => c.key === nameKey('Reliance Retail'));
  assert.equal(rel.rows, 2);
  assert.equal(rel.decision.action, 'use_existing'); assert.equal(rel.decision.clientId, 'c-rel');
  assert.equal(rel.needsReview, false);
  const short = entities.clients.find((c) => c.key === 'reliance');
  assert.equal(short.match.type, 'near');
  assert.equal(short.decision.action, 'create');     // never merged silently
  assert.equal(short.needsReview, true);
  assert.equal(entities.clients.find((c) => c.key === 'tata trent').decision.clientId, 'c-tata');
});

test('clients: HR can accept the suggestion or create new; a bad id is ignored', () => {
  const merged = plan({}, { clients: { reliance: { action: 'use_existing', clientId: 'c-rel' } } });
  assert.equal(merged.entities.clients.find((c) => c.key === 'reliance').decision.clientId, 'c-rel');
  const bad = plan({}, { clients: { reliance: { action: 'use_existing', clientId: 'nope' } } });
  assert.equal(bad.entities.clients.find((c) => c.key === 'reliance').decision.action, 'create');
});

test('clients: no permission to create means new clients are blocked and their rows say why', () => {
  const p = plan({ permissions: { createClients: false } });
  const short = p.entities.clients.find((c) => c.key === 'reliance');
  assert.equal(short.blocked, true);
  const row = p.rows.find((r) => r.rowNumber === 7);
  assert.equal(row.plan.action, 'blocked');
  assert.ok(row.issues.some((i) => i.code === 'client_not_allowed'));
  assert.equal(p.rows.find((r) => r.rowNumber === 2).plan.action, 'import'); // existing client rows are fine
});

test('locations: matched through aliases, new otherwise', () => {
  const { entities } = plan();
  const and = entities.locations.find((l) => l.label === 'Andheri' && l.clientKey === nameKey('Reliance Retail'));
  assert.equal(and.decision.action, 'use_existing'); assert.equal(and.decision.locationId, 'l-and');
  const pune = entities.locations.find((l) => l.label === 'Pune');
  assert.equal(pune.decision.action, 'create');
});

test('positions: matches an open one, ignores a cancelled one, creates the rest', () => {
  const { entities } = plan();
  const cash = entities.positions.find((p) => p.designation === 'Cashier' && p.clientKey === nameKey('Reliance Retail'));
  assert.equal(cash.decision.positionId, 'p-cash');
  const mgr = entities.positions.find((p) => p.designation === 'Store Manager');
  assert.equal(mgr.decision.action, 'create');       // the only existing one is cancelled
  assert.equal(entities.positions.find((p) => p.designation === 'Sales Executive').decision.action, 'create');
});

test('recruiters: matched by name; unknown ones fall back to the importer', () => {
  const { entities, rows } = plan();
  assert.equal(entities.recruiters.find((r) => r.key === 'neha gupta').decision.userId, 'u-neha');
  assert.equal(entities.recruiters.find((r) => r.key === 'someone else').decision.userId, null);
  assert.equal(rows[0].plan.tracker.assignedHr, 'u-neha');
  assert.equal(rows[2].plan.tracker.assignedHr, null);
});

test('candidates: found by phone in the database, one person across rows, default is to reuse', () => {
  const p = plan();
  const priya = p.rows[1].plan;
  assert.equal(priya.existingCandidate.id, 'k-priya'); assert.equal(priya.candidateAction, 'use_existing');
  assert.equal(p.summary.candidates.unique, 4);        // Rahul x3 counted once
  assert.equal(p.summary.candidates.existing, 1);
  assert.equal(p.summary.candidates.new, 3);
  assert.equal(p.rows[0].plan.candidateKey, p.rows[3].plan.candidateKey);
  const forced = plan({}, { candidates: { 'p:+919812345678': { action: 'skip' } } });
  assert.equal(forced.rows[1].plan.action, 'skip');
  const impossible = plan({}, { candidates: { 'p:+919876543210': { action: 'use_existing' } } }); // nothing to reuse
  assert.equal(impossible.rows[0].plan.candidateAction, 'create');
});

test('candidates: same phone, clearly different name is flagged', () => {
  const p = plan({ candidates: [{ id: 'k-x', firstName: 'Zubin', lastName: 'Mehta', phone: '9812345678', phoneNormalized: '+919812345678' }] });
  assert.ok(p.rows[1].issues.some((i) => i.code === 'name_mismatch'));
});

test('trackers: stage, status, reason and historic come from the sheet', () => {
  const p = plan();
  const t = (n) => p.rows.find((r) => r.rowNumber === n).plan.tracker;
  assert.equal(t(2).stageKey, 'turnup'); assert.equal(t(2).historic, true);        // 13 Oct < 14 Oct
  assert.equal(t(3).status, 'rejected'); assert.equal(t(3).reason, 'No show');
  assert.equal(t(4).historic, false);                                                // 20 Oct is ahead
  assert.equal(t(7).stageKey, 'offer');
  assert.equal(p.summary.trackers.historic, 3);
});

test('trackers: an exact repeated row is skipped, not doubled', () => {
  const p = plan();
  const dup = p.rows.find((r) => r.rowNumber === 6);
  assert.equal(dup.plan.tracker.action, 'skip'); assert.equal(dup.plan.tracker.skipReason, 'duplicate_row');
  assert.equal(p.rows.find((r) => r.rowNumber === 5).plan.tracker.action, 'create'); // second client: kept
});

test('trackers: already live for the same position in the database is skipped; a closed one is not', () => {
  const live = plan({ candidates: [{ id: 'k-priya', firstName: 'Priya', lastName: 'Verma', phone: '9812345678', phoneNormalized: '+919812345678' }], liveTags: [{ candidateId: 'k-priya', openPositionId: 'p-cash' }] });
  // Priya's row is "No show" (rejected) so it is not live: still created
  assert.equal(live.rows[1].plan.tracker.action, 'create');
  const g2 = [grid[0], ['Priya Verma', 9812345678, 'Reliance Retail', 'Cashier', 'Andheri', '13/10/2026', 'Lined up', null]];
  const s2 = [analyseSheet({ name: 'S', rows: g2 }, opts)];
  const p2 = buildPlan({ sheets: s2, catalog: catalog({ liveTags: [{ candidateId: 'k-priya', openPositionId: 'p-cash' }] }), opts: { now: NOW } });
  assert.equal(p2.rows[0].plan.tracker.action, 'skip'); assert.equal(p2.rows[0].plan.tracker.skipReason, 'already_live');
});

test('trackers: two live rows for one person and position in the file keep only the first', () => {
  const g = [grid[0],
    ['Dev Patel', 9555500001, 'Tata Trent', 'Cashier', 'Pune', '10/10/2026', 'Lined up', null],
    ['Dev Patel', 9555500001, 'Tata Trent', 'Cashier', 'Pune', '12/10/2026', 'Reached', null]];
  const p = buildPlan({ sheets: [analyseSheet({ name: 'S', rows: g }, opts)], catalog: catalog(), opts: { now: NOW } });
  assert.equal(p.rows[0].plan.tracker.action, 'create');
  assert.equal(p.rows[1].plan.tracker.skipReason, 'duplicate_live');
});

test('trackers: a pipeline without the stage gets the nearest earlier one, with a warning', () => {
  const p = plan({ stages: STAGES.filter((s) => s.stageKey !== 'turnup') });
  const row = p.rows.find((r) => r.rowNumber === 2);
  assert.equal(row.plan.tracker.stageKey, 'lineup');
  assert.ok(row.issues.some((i) => i.code === 'stage_missing'));
});

test('rows: HR can exclude a row; a row with no name and no existing match is blocked', () => {
  const p = plan({}, { rows: { 'S:3': { action: 'skip' } } });
  assert.equal(p.rows.find((r) => r.rowNumber === 3).plan.action, 'skip');
  const g = [grid[0], [null, null, 'Tata Trent', 'Cashier', 'Pune', '10/10/2026', 'Lined up', null]];
  const b = buildPlan({ sheets: [analyseSheet({ name: 'S', rows: g }, opts)], catalog: catalog(), opts: { now: NOW } });
  assert.equal(b.rows[0].plan.action, 'blocked'); assert.equal(b.summary.rows.blocked, 1);
});

test('summary: counts that the preview screen shows, and what plan limits will see', () => {
  const s = plan().summary;
  assert.equal(s.rows.total, 6); assert.equal(s.rows.import, 6);
  assert.equal(s.trackers.create, 5); assert.equal(s.trackers.skip, 1);
  assert.equal(s.candidates.new, 3);
  assert.equal(s.newCandidateRows, 3);
  assert.equal(s.clients.needsReview, 1);
  assert.equal(s.recruiters.unmatched, 1);
});

test('candidate-only sheets plan candidates and no trackers', () => {
  const g = [['Name', 'Phone', 'Email'], ['Anil Kapoor', '9811111111', 'anil@x.com'], ['Priya Verma', '9812345678', null]];
  const p = buildPlan({ sheets: [analyseSheet({ name: 'DB', rows: g }, opts)], catalog: catalog(), opts: { now: NOW } });
  assert.equal(p.summary.trackers.create, 0);
  assert.equal(p.summary.candidates.new, 1); assert.equal(p.summary.candidates.existing, 1);
  assert.equal(p.rows[0].plan.tracker, undefined);
});

test('candidates: one that exists in a team the importer cannot see is skipped without being named', () => {
  const p = plan({ candidates: [], hiddenPhones: ['+919876543210'] });
  const row = p.rows[0];
  assert.equal(row.plan.candidateAction, 'skip'); assert.equal(row.plan.action, 'skip');
  assert.ok(row.issues.some((i) => i.code === 'exists_elsewhere'));
  assert.equal(row.plan.existingCandidate, undefined);
  assert.ok(!JSON.stringify(p).includes('Zubin'));
});
