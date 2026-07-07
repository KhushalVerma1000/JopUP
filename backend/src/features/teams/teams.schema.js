const { z } = require('zod');

const createTeamSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional()
  })
});

const updateTeamSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'archived']).optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid team ID')
  })
});

const getTeamParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid team ID')
  })
});

module.exports = {
  createTeamSchema,
  updateTeamSchema,
  getTeamParamsSchema
};
