const { z } = require('zod');
const { toDateOnly } = require('./performance.math');

const uuid = (what) => z.string().uuid(`Invalid ${what}`);

// Accepts 'YYYY-MM-DD' (what a date picker sends) or a full ISO datetime, and
// hands the service a plain 'YYYY-MM-DD' — the DB columns are `date`.
const dateInput = z.string().refine((v) => toDateOnly(v) !== null, 'Use a valid date, e.g. 2026-03-31').transform(toDateOnly);

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
const createKpiSchema = z.object({ body: z.object(kpiFields) });

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
    notes: z.string().trim().max(1000).optional(),
  }),
});

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
  }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  params: z.object({ id: uuid('goal ID') }),
});

const goalProgressSchema = z.object({
  body: z.object({ progressPct: z.number().int().min(0).max(100), complete: z.boolean().optional() }),
  params: z.object({ id: uuid('goal ID') }),
});

const keyResultSchema = z.object({
  kr: z.string().trim().min(1).max(200),
  target: z.number().finite(),
  current: z.number().finite().optional(),
});
const objectivesSchema = z.array(z.object({
  objective: z.string().trim().min(1).max(200),
  key_results: z.array(keyResultSchema).max(10).default([]),
})).max(10);

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
  }),
});

const updateStrategySchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(160),
    period: z.string().trim().min(1).max(40),
    description: z.string().trim().max(2000),
    objectives: objectivesSchema,
    status: z.enum(['draft', 'active', 'archived']),
  }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  params: z.object({ id: uuid('strategy ID') }),
});

const idParamsSchema = z.object({ params: z.object({ id: uuid('ID') }) });

module.exports = {
  listKpisSchema, createKpiSchema, updateKpiSchema, kpiEntriesSchema, createKpiEntrySchema,
  listReviewsSchema, createReviewSchema, updateReviewSchema,
  listGoalsSchema, createGoalSchema, updateGoalSchema, goalProgressSchema,
  listStrategiesSchema, createStrategySchema, updateStrategySchema,
  idParamsSchema,
  // kept for older imports
  genericParamsSchema: idParamsSchema,
};
