const { z } = require('zod');

const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

// Public form: an Enterprise trial request, or "I want Pro". `website` is a honeypot
// (hidden from people, filled by bots): a request that fills it is dropped silently.
const createRequestSchema = z.object({
  body: z.object({
    plan: z.enum(['enterprise', 'pro']).default('enterprise'),
    name: z.string().trim().min(2, 'Enter your name').max(80),
    email: z.string().trim().email('Enter a valid work email, like name@company.com').max(160),
    company: z.string().trim().min(2, 'Enter your company name').max(120),
    phone: optionalText(30),
    teamSize: optionalText(40),
    message: optionalText(1000),
    website: z.string().max(200).optional(),
  }),
});

module.exports = { createRequestSchema };
