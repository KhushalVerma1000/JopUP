const { z } = require('zod');
const { toDateOnly, parsePeriod } = require('./performance.math');
const { getMetric } = require('./metrics.catalogue');

const uuid = (what) => z.string().uuid(`Invalid ${what}`);

// Accepts 'YYYY-MM-DD' (what a date picker sends) or a full ISO datetime, and
// hands the service a plain 'YYYY-MM-DD' — the DB columns are `date`.
const dateInput = z.string().refine((v) => toDateOnly(v) !== null, 'Use a valid date, e.g. 2026-03-31').transform(toDateOnly);

const metricKey = z.string().refine((k) => !!getMetric(k), 'Unknown metric. Pick one from the metric list');

const kpiFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  teamId: uuid('team ID'),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(60).optional(),
  unit: z.string().trim().max(20).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
  targetValue: z.number().finite().optional(),
  direction: z.enum(['higher_better', 'lower_better', 'target_exact']).optional(),
};

const listKpisSchema = z.object({
  query: z.object({
    teamId: uuid('team ID').optional(),
    includeInactive: z.enum(['true', 'false']).optional(),
  }),
});

const { teamId: _teamId, ...kpiEditableFields } = kpiFields;
// An automatic KPI is just "which metric, which team, what target": the name,
// unit and direction fall back to the metric's own, and the readings fill themselves in.
const createKpiSchema = z.object({
  body: z.object({ ...kpiFields, name: kpiFields.name.optional(), metricKey: metricKey.optional(), source: z.enum(['auto', 'manual']).optional() })
    .superRefine((b, ctx) => {
      if (b.source === 'manual' && b.metricKey) ctx.addIssue({ code: 'custom', path: ['metricKey'], message: 'A manual KPI has no metric. Leave it out or choose automatic' });
      if (b.source === 'auto' && !b.metricKey) ctx.addIssue({ code: 'custom', path: ['metricKey'], message: 'Choose which metric this KPI measures' });
      if (!b.metricKey && !b.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required' });
    }),
});

const updateKpiSchema = z.object({
  // A KPI never moves between teams: its history belongs to the team that recorded it.
  body: z.object({ ...kpiEditableFields, isActive: z.boolean().optional() }).partial().strict()
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  params: z.object({ id: uuid('KPI ID') }),
});

const kpiEntriesSchema = z.object({
  params: z.object({ id: uuid('KPI ID') }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
});

const createKpiEntrySchema = z.object({
  body: z.object({
    kpiId: uuid('KPI ID'),
    // Optional: the entry always belongs to the KPI's team. If sent it must match.
    teamId: uuid('team ID').optional(),
    value: z.number().finite(),
    periodLabel: z.string().trim().min(1).max(40).optional(),
    periodDate: dateInput.optional(),
    // For an automatic KPI this is the reason for overriding the computed value.
    notes: z.string().trim().max(1000).optional(),
  }),
});

const entryIdParamsSchema = z.object({ params: z.object({ id: uuid('entry ID') }) });
const syncSchema = z.object({ body: z.object({ force: z.boolean().optional() }).optional() });

const scoresSchema = z.record(z.string().min(1).max(40), z.number().min(1, 'Scores run from 1 to 5').max(5, 'Scores run from 1 to 5'));

const listReviewsSchema = z.object({
  query: z.object({
    teamId: uuid('team ID').optional(),
    revieweeId: uuid('user ID').optional(),
    status: z.enum(['draft', 'submitted', 'acknowledged']).optional(),
  }),
});

const createReviewSchema = z.object({
  body: z.object({
    teamId: uuid('team ID'),
    revieweeId: uuid('user ID'),
    cycle: z.string().trim().min(1, 'Cycle is required').max(40),
    scores: scoresSchema.optional(),
    summary: z.string().trim().max(4000).optional(),
    managerNotes: z.string().trim().max(4000).optional(),
  }),
});

const updateReviewSchema = z.object({
  // 'acknowledged' is deliberately absent: only the person reviewed can acknowledge (own endpoint).
  body: z.object({
    status: z.literal('submitted').optional(),
    scores: scoresSchema.optional(),
    summary: z.string().trim().max(4000).optional(),
    managerNotes: z.string().trim().max(4000).optional(),
  }).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  params: z.object({ id: uuid('review ID') }),
});

const listGoalsSchema = z.object({
  query: z.object({
    teamId: uuid('team ID').optional(),
    assignedTo: uuid('user ID').optional(),
    status: z.enum(['active', 'completed', 'cancelled', 'overdue']).optional(),
  }),
});

const createGoalSchema = z.object({
  body: z.object({
    teamId: uuid('team ID'),
    title: z.string().trim().min(1, 'Title is required').max(160),
    description: z.string().trim().max(2000).optional(),
    assignedTo: uuid('user ID').optional(),
    dueDate: dateInput.optional(),
    progressPct: z.number().int().min(0).max(100).optional(),
    // Metric goal: progress is measured from the pipeline between startDate and dueDate.
    metricKey: metricKey.optional(),
    targetValue: z.number().finite().positive('Target must be more than zero').optional(),
    startDate: dateInput.optional(),
  }).superRefine((b, ctx) => {
    if (b.metricKey) {
      if (b.targetValue === undefined) ctx.addIssue({ code: 'custom', path: ['targetValue'], message: 'Set a target for this goal' });
      if (!b.dueDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Set a due date so progress has a window to be measured in' });
      if (b.progressPct !== undefined) ctx.addIssue({ code: 'custom', path: ['progressPct'], message: 'Progress is computed automatically for a metric goal' });
      if (b.startDate && b.dueDate && b.startDate > b.dueDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date must be before the due date' });
    } else if (b.targetValue !== undefined || b.startDate) {
      ctx.addIssue({ code: 'custom', path: ['metricKey'], message: 'Choose a metric to measure this goal by' });
    }
  }),
});

const updateGoalSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000),
    assignedTo: uuid('user ID').nullable(),
    status: z.enum(['active', 'completed', 'cancelled']),
    progressPct: z.number().int().min(0).max(100),
    dueDate: dateInput.nullable(),
    targetValue: z.number().finite().positive(),
    startDate: dateInput,
  }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  params: z.object({ id: uuid('goal ID') }),
});

const goalProgressSchema = z.object({
  body: z.object({ progressPct: z.number().int().min(0).max(100), complete: z.boolean().optional() }),
  params: z.object({ id: uuid('goal ID') }),
});

// A key result is measured one of four ways. 'manual' (the default, and what every
// older strategy has) uses the number a person types; the others are computed.
const keyResultSchema = z.object({
  kr: z.string().trim().min(1).max(200),
  target: z.number().finite(),
  current: z.number().finite().optional(),
  type: z.enum(['manual', 'metric', 'kpi', 'goal']).default('manual'),
  metric_key: metricKey.optional(),
  kpi_id: uuid('KPI ID').optional(),
  goal_ids: z.array(uuid('goal ID')).min(1).max(20).optional(),
}).superRefine((k, ctx) => {
  if (k.type === 'metric' && !k.metric_key) ctx.addIssue({ code: 'custom', path: ['metric_key'], message: 'Choose the metric this key result is measured by' });
  if (k.type === 'kpi' && !k.kpi_id) ctx.addIssue({ code: 'custom', path: ['kpi_id'], message: 'Choose the KPI this key result follows' });
  if (k.type === 'goal' && !k.goal_ids?.length) ctx.addIssue({ code: 'custom', path: ['goal_ids'], message: 'Choose the goals this key result rolls up' });
});
const objectivesSchema = z.array(z.object({
  objective: z.string().trim().min(1).max(200),
  key_results: z.array(keyResultSchema).max(10).default([]),
})).max(10);

function windowRule(b, ctx) {
  if ((b.startDate && !b.endDate) || (!b.startDate && b.endDate)) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Give both a start and an end date' });
  if (b.startDate && b.endDate && b.startDate > b.endDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date must be before the end date' });
}

const listStrategiesSchema = z.object({
  query: z.object({
    teamId: uuid('team ID').optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
  }),
});

const createStrategySchema = z.object({
  body: z.object({
    teamId: uuid('team ID'),
    title: z.string().trim().min(1, 'Title is required').max(160),
    period: z.string().trim().min(1, 'Period is required').max(40),
    description: z.string().trim().max(2000).optional(),
    objectives: objectivesSchema.optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    // Optional: read from `period` when it is like "Q4 2026" / "H2 2026" / "Oct 2026".
    startDate: dateInput.optional(),
    endDate: dateInput.optional(),
  }).superRefine(windowRule),
});

const updateStrategySchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(160),
    period: z.string().trim().min(1).max(40),
    description: z.string().trim().max(2000),
    objectives: objectivesSchema,
    status: z.enum(['draft', 'active', 'archived']),
    startDate: dateInput,
    endDate: dateInput,
    retrospective: z.string().trim().max(4000),
  }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  params: z.object({ id: uuid('strategy ID') }),
});

const idParamsSchema = z.object({ params: z.object({ id: uuid('ID') }) });

module.exports = {
  listKpisSchema, createKpiSchema, updateKpiSchema, kpiEntriesSchema, createKpiEntrySchema,
  listReviewsSchema, createReviewSchema, updateReviewSchema,
  listGoalsSchema, createGoalSchema, updateGoalSchema, goalProgressSchema,
  listStrategiesSchema, createStrategySchema, updateStrategySchema,
  idParamsSchema, entryIdParamsSchema, syncSchema, parsePeriod,
  // kept for older imports
  genericParamsSchema: idParamsSchema,
};
