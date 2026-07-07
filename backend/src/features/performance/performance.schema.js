const { z } = require('zod');

const createKpiSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    teamId: z.string().uuid('Invalid team ID'),
    description: z.string().optional(),
    category: z.string().optional(),
    unit: z.string().optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
    targetValue: z.number().optional(),
    direction: z.enum(['higher_better', 'lower_better', 'target_exact']).optional()
  })
});

const updateKpiSchema = z.object({
  body: createKpiSchema.shape.body.partial().extend({
    isActive: z.boolean().optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid KPI ID')
  })
});

const createKpiEntrySchema = z.object({
  body: z.object({
    kpiId: z.string().uuid('Invalid KPI ID'),
    teamId: z.string().uuid('Invalid team ID'),
    value: z.number(),
    periodLabel: z.string().min(1, 'Period label is required'),
    periodDate: z.string().datetime().optional(), // Or custom date validation
    notes: z.string().optional()
  })
});

const createReviewSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    revieweeId: z.string().uuid('Invalid user ID'),
    cycle: z.string().min(1, 'Cycle is required'),
    scores: z.record(z.any()).optional(),
    summary: z.string().optional(),
    managerNotes: z.string().optional()
  })
});

const updateReviewSchema = z.object({
  body: z.object({
    status: z.enum(['draft', 'submitted', 'acknowledged']).optional(),
    scores: z.record(z.any()).optional(),
    summary: z.string().optional(),
    managerNotes: z.string().optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid review ID')
  })
});

const createGoalSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    assignedTo: z.string().uuid('Invalid user ID').optional(),
    dueDate: z.string().datetime().optional(),
    progressPct: z.number().min(0).max(100).optional()
  })
});

const updateGoalSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'completed', 'cancelled', 'overdue']).optional(),
    progressPct: z.number().min(0).max(100).optional(),
    dueDate: z.string().datetime().optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid goal ID')
  })
});

const createStrategySchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    title: z.string().min(1, 'Title is required'),
    period: z.string().min(1, 'Period is required'),
    description: z.string().optional(),
    objectives: z.array(z.any()).optional(),
    status: z.enum(['draft', 'active', 'archived']).optional()
  })
});

const updateStrategySchema = z.object({
  body: createStrategySchema.shape.body.partial(),
  params: z.object({
    id: z.string().uuid('Invalid strategy ID')
  })
});

const genericParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid ID')
  })
});

module.exports = {
  createKpiSchema,
  updateKpiSchema,
  createKpiEntrySchema,
  createReviewSchema,
  updateReviewSchema,
  createGoalSchema,
  updateGoalSchema,
  createStrategySchema,
  updateStrategySchema,
  genericParamsSchema
};
