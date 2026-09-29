const { z } = require('zod');

// ADR-1: application is now pure metadata — the fact a candidate applied
// to a specific job posting. All stage/status fields moved to the
// trackers feature (see ../trackers/trackers.schema.js). jobPostingId is
// required (was optional) — that's what distinguishes "applied via a
// posting" from a direct HR add, which goes through POST /trackers
// instead and never creates an application row at all.
const createApplicationSchema = z.object({
  body: z.object({
    candidateId: z.string().uuid('Invalid candidate ID'),
    jobPostingId: z.string().uuid('Invalid job posting ID'),
    entrySource: z.string().optional(),
  })
});

const applicationParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid application ID')
  })
});

module.exports = {
  createApplicationSchema,
  applicationParamsSchema,
};
