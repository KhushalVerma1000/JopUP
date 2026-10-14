const { z } = require('zod');

const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// One reviewed draft. Parsed drafts come back with nulls for missing fields,
// so every optional field is nullish here and nulls are dropped afterwards.
const draftSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().nullish(),
  email: z.string().email('Invalid email').nullish(),
  phone: z.string().nullish(),
  phoneCountry: z.string().length(2, 'Use a 2-letter country code (e.g. "IN")').nullish(),
  location: z.string().nullish(),
  linkedinUrl: z.string().url('Invalid URL').nullish(),
  skills: z.array(z.string()).optional(),
  notes: z.string().nullish(),
  sourceRef: z.string().nullish(),
  parsedResume: z.record(z.string(), z.any()).nullish(),
  confirmDuplicate: z.boolean().optional(),
}).refine((d) => !d.phone || Boolean(d.phoneCountry), {
  message: 'phoneCountry is required when phone is provided',
  path: ['phoneCountry'],
}).transform(stripNulls);

const bulkCreateSchema = z.object({
  body: z.object({
    ownerTeamId: z.string().uuid('Invalid team ID'),
    items: z.array(draftSchema).min(1, 'At least one candidate is required').max(100, 'Max 100 candidates per request'),
  }),
});

module.exports = { bulkCreateSchema };
