const { z } = require('zod');

const uuid = (m) => z.string().uuid(m);
const clientParams = z.object({ id: uuid('Invalid client ID') });
const aliases = z.array(z.string().trim().min(1).max(60)).max(20)
  .transform((a) => [...new Map(a.map((x) => [x.toLowerCase(), x])).values()]);

const listSchema = z.object({ params: clientParams });

const createLocationSchema = z.object({
  params: clientParams,
  body: z.object({
    name: z.string().trim().min(1).max(80),
    aliases: aliases.default([]),
    trackerTemplateId: uuid('Invalid template ID').nullable().optional(),
  }),
});
const updateLocationSchema = z.object({
  params: clientParams.extend({ locationId: uuid('Invalid location ID') }),
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    aliases: aliases.optional(),
    trackerTemplateId: uuid('Invalid template ID').nullable().optional(),
  }).refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
});
const locationParams = z.object({ params: clientParams.extend({ locationId: uuid('Invalid location ID') }) });

const contactFields = {
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z.string().trim().max(30).nullable().optional(),
  designation: z.string().trim().max(80).nullable().optional(),
  // null = a client-wide contact, used when no location matches
  locationId: uuid('Invalid location ID').nullable().optional(),
  mailRole: z.enum(['to', 'cc']),
  receivesTrackersByDefault: z.boolean(),
};
// Defaults only on create. An edit must never silently reset a field it did not send.
const contactBody = z.object({ ...contactFields, mailRole: contactFields.mailRole.default('to'), receivesTrackersByDefault: contactFields.receivesTrackersByDefault.default(true) });
const contactPatch = z.object(contactFields).partial();
const createContactSchema = z.object({ params: clientParams, body: contactBody });
const updateContactSchema = z.object({
  params: clientParams.extend({ contactId: uuid('Invalid contact ID') }),
  body: contactPatch.refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
});
const contactParams = z.object({ params: clientParams.extend({ contactId: uuid('Invalid contact ID') }) });

module.exports = {
  listSchema, createLocationSchema, updateLocationSchema, locationParams,
  createContactSchema, updateContactSchema, contactParams,
};
