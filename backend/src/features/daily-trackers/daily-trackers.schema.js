const { z } = require('zod');

const sendTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 18:00');
const emails = z.array(z.string().trim().toLowerCase().email('Enter valid email addresses')).max(20, 'Up to 20 addresses');
const sendDays = z.array(z.number().int().min(1).max(7)).min(1, 'Choose at least one day').max(7)
  .refine((d) => new Set(d).size === d.length, 'Days must be unique');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const fields = {
  enabled: z.boolean(),
  sendTime,
  timezone: z.string().min(1).nullable(),
  sendDays,
  skipIfEmpty: z.boolean(),
  toEmails: emails,
  ccEmails: emails,
  includeClientContacts: z.boolean(),
};

const overviewSchema = z.object({
  query: z.object({ teamId: z.string().uuid('Invalid team ID'), date: ymd.optional() }),
});

const listSchedulesSchema = z.object({
  query: z.object({ teamId: z.string().uuid().optional() }),
});

const createScheduleSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    clientId: z.string().uuid('Invalid client ID').nullable().optional(),
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
  }),
});

const updateScheduleSchema = z.object({
  body: z.object({
    teamId: z.string().uuid().optional(),
    clientId: z.string().uuid().nullable().optional(),
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
  }).refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' }),
  params: z.object({ id: z.string().uuid('Invalid schedule ID') }),
});

const scheduleParamsSchema = z.object({ params: z.object({ id: z.string().uuid('Invalid schedule ID') }) });

module.exports = { overviewSchema, listSchedulesSchema, createScheduleSchema, updateScheduleSchema, scheduleParamsSchema };
