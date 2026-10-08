const { z } = require('zod');

// The screen already shows HR a filtered list; it sends the ids it is showing,
// so the mail can never contain someone the HR didn't see. The server still
// re-reads every tracker and re-checks tenant and team access.
const composeSchema = z.object({
  body: z.object({
    type: z.enum(['lineup', 'interview_reminder']),
    trackerIds: z.array(z.string().uuid('Invalid tracker ID')).min(1, 'Pick at least one candidate').max(200),
    // The local day HR is mailing about, only used to word the subject when
    // the trackers span several days. YYYY-MM-DD.
    // Mailing one specific client (uuid) or the internal hires (null). When given,
    // every selected candidate must belong to it — see clientScope.js.
    clientId: z.string().uuid('Invalid client ID').nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  }),
});

module.exports = { composeSchema };
