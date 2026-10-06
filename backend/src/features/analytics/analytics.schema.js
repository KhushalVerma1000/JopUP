const { z } = require('zod');

const pipelineQuerySchema = z.object({
  query: z.object({
    teamId: z.string().uuid('Invalid team ID').optional(),
    // Look-back window by when a candidate entered the pipeline. 'all' = no limit.
    days: z.union([z.literal('all'), z.coerce.number().int().min(1).max(3650)]).optional(),
    // A live candidate who has sat in one stage longer than this is "stuck".
    stuckAfterDays: z.coerce.number().int().min(1).max(60).optional(),
  }),
});

module.exports = { pipelineQuerySchema };
