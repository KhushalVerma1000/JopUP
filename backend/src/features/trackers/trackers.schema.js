const { z } = require('zod');

const inlineCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().min(1, 'Phone is required'),
  // ISO 3166-1 alpha-2 — required alongside phone here too (ADR-2 / global
  // platform: a bare number is ambiguous without knowing its country).
  phoneCountry: z.string().length(2, 'Use a 2-letter country code (e.g. "IN", "US")'),
  // Set true to proceed after a PossibleDuplicateError was already shown
  // to the user once and they chose "create anyway".
  confirmDuplicate: z.boolean().optional(),
});

const createTrackerSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    // Provide exactly one of these — an existing candidate to track, or
    // enough to create-and-link one in the same call (the "quick add").
    candidateId: z.string().uuid('Invalid candidate ID').optional(),
    candidate: inlineCandidateSchema.optional(),
    openPositionId: z.string().uuid('Invalid open position ID').optional(),
    workflowTemplateId: z.string().uuid('Invalid template ID').optional(),
    assignedHr: z.string().uuid('Invalid user ID').optional(),
    interviewDate: z.string().datetime().optional(),
    lineupDate: z.string().datetime().optional(),
    notes: z.string().optional(),
  }).refine((body) => Boolean(body.candidateId) !== Boolean(body.candidate), {
    message: 'Provide exactly one of candidateId or candidate',
  }),
});

const advanceStageSchema = z.object({
  body: z.object({
    nextStageId: z.string().uuid('Invalid stage ID'),
    // Free-text status HR attaches to the move ("Reached", "Not reachable"…),
    // stored on the new stage-log row.
    note: z.string().max(500).optional(),
  }),
  params: z.object({
    id: z.string().uuid('Invalid tracker ID'),
  }),
});

// Tag many existing candidates to one open position in one call.
const tagCandidatesSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    openPositionId: z.string().uuid('Invalid open position ID'),
    candidateIds: z.array(z.string().uuid('Invalid candidate ID')).min(1, 'Choose at least one candidate').max(100, 'Tag up to 100 candidates at a time'),
  }),
});

// Re-tag a tracker to a different open position (or untag with null) and
// adjust the dates/notes — the "tag candidate to position" path for
// candidates already in the pipeline.
const updateTrackerSchema = z.object({
  body: z.object({
    openPositionId: z.string().uuid('Invalid open position ID').nullable().optional(),
    interviewDate: z.string().datetime().nullable().optional(),
    lineupDate: z.string().datetime().nullable().optional(),
    notes: z.string().nullable().optional(),
  }).refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' }),
  params: z.object({
    id: z.string().uuid('Invalid tracker ID'),
  }),
});

const blockTrackerSchema = z.object({
  body: z.object({
    reason: z.string().min(1, 'Reason is required'),
  }),
  params: z.object({
    id: z.string().uuid('Invalid tracker ID'),
  }),
});

const addActionSchema = z.object({
  body: z.object({
    actionType: z.string().min(1, 'Action type is required'),
    content: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  }),
  params: z.object({
    id: z.string().uuid('Invalid tracker ID'),
    logId: z.string().uuid('Invalid log ID'),
  }),
});

const trackerParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid tracker ID'),
  }),
});

module.exports = {
  createTrackerSchema,
  advanceStageSchema,
  tagCandidatesSchema,
  updateTrackerSchema,
  blockTrackerSchema,
  addActionSchema,
  trackerParamsSchema,
};
