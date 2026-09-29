const { z } = require('zod');

const createOpenPositionSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    // Omit for an internal hire — see 17-open-position.ts.
    clientId: z.string().uuid('Invalid client ID').optional(),
    designation: z.string().min(1, 'Designation is required'),
    location: z.string().optional(),
    experienceRequired: z.string().optional(),
    vacancies: z.number().int().min(1).optional(),
    notes: z.string().optional(),
  }),
});

const updateOpenPositionSchema = z.object({
  body: createOpenPositionSchema.shape.body.partial().extend({
    status: z.enum(['open', 'on_hold', 'filled', 'cancelled']).optional(),
  }),
  params: z.object({
    id: z.string().uuid('Invalid open position ID'),
  }),
});

const openPositionParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid open position ID'),
  }),
});

module.exports = {
  createOpenPositionSchema,
  updateOpenPositionSchema,
  openPositionParamsSchema,
};
