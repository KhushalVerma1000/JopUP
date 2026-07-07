const { z } = require('zod');

const topUpSchema = z.object({
  body: z.object({
    amount: z.number().int().min(1, 'Amount must be positive'),
    description: z.string().optional()
  })
});

const adjustSchema = z.object({
  body: z.object({
    amount: z.number().int(),
    description: z.string().min(1, 'Description is required')
  })
});

const transactionQuerySchema = z.object({
  query: z.object({
    type: z.enum(['earned', 'topped_up', 'spent', 'refunded', 'expired', 'adjusted']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0)
  })
});

module.exports = {
  topUpSchema,
  adjustSchema,
  transactionQuerySchema
};
