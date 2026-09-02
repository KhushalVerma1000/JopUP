const express = require('express');
require('express-async-errors'); // Captures unhandled async errors in routes automatically

const tenant = require('./middlewares/tenant');
const errorHandler = require('./middlewares/errorHandler');

// Feature Route Modules
const authRoutes = require('./features/auth/auth.routes');
const plansRoutes = require('./features/plans/plans.routes');
const organizationRoutes = require('./features/organizations/organization.routes');
const candidatesRoutes = require('./features/candidates/candidates.routes');
const teamsRoutes = require('./features/teams/teams.routes');
const clientsRoutes = require('./features/clients/clients.routes');
const workflowRoutes = require('./features/workflow/workflow.routes');
const jobPostingsRoutes = require('./features/job-postings/job-postings.routes');
const applicationsRoutes = require('./features/applications/applications.routes');
const performanceRoutes = require('./features/performance/performance.routes');
const creditsRoutes = require('./features/credits/credits.routes');
const portalRoutes = require('./features/job-portal/job-portal.routes');

const app = express();

// Global Middlewares
app.use(express.json());
app.use(tenant); // Extracts tenant ID from headers globally

// Basic Health Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Feature routes registration
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/plans', plansRoutes);
app.use('/api/v1/organizations', organizationRoutes);
app.use('/api/v1/candidates', candidatesRoutes);
app.use('/api/v1/teams', teamsRoutes);
app.use('/api/v1/clients', clientsRoutes);
app.use('/api/v1/workflows', workflowRoutes);
app.use('/api/v1/job-postings', jobPostingsRoutes);
app.use('/api/v1/applications', applicationsRoutes);
app.use('/api/v1/performance', performanceRoutes);
app.use('/api/v1/credits', creditsRoutes);
app.use('/api/v1/portal', portalRoutes);

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;


