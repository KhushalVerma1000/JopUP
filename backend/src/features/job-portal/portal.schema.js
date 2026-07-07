const { z } = require('zod');

const registerJobSeekerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    resumeUrl: z.string().optional().nullable(),
    linkedinUrl: z.string().optional().nullable(),
    skills: z.array(z.string()).optional().default([]),
  }),
});

const loginJobSeekerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

const submitPortalApplicationSchema = z.object({
  body: z.object({
    jobPostingId: z.string().uuid('Job posting ID must be a valid UUID'),
    coverLetter: z.string().optional().nullable(),
    resumeUrl: z.string().optional().nullable(),
  }),
});

module.exports = {
  registerJobSeekerSchema,
  loginJobSeekerSchema,
  submitPortalApplicationSchema,
};
