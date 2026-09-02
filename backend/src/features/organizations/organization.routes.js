const express = require('express');
const router = express.Router();
const controller = require('./organization.controller');
const validate = require('../../middlewares/validate');
const schema = require('./organization.schema');
const { requireAuth } = require('../../middlewares/requireAuth');

// POST stays public — this is tenant signup (creating a brand-new organisation),
// not an action an existing staff member performs.
router.post('/', validate(schema.createOrganizationSchema), controller.create.bind(controller));

// NOTE: 'organisations' read/write is a platform_admin-only permission in seed.ts,
// but there is no platform-scoped login yet (auth.service.js only issues org-scoped
// JWTs from staff login). Until that exists, these are gated by requireAuth only —
// any authenticated staff member of *an* org can currently read/update *any* org's
// record via these routes. This is a real gap, not an intentional design choice —
// see walkthrough.md "Known Gaps" for the follow-up.
router.get('/', requireAuth, controller.list.bind(controller));
router.get('/:id', requireAuth, validate(schema.getOrgParamsSchema), controller.getById.bind(controller));
router.patch('/:id', requireAuth, validate(schema.updateOrganizationSchema), controller.update.bind(controller));
router.get('/:id/modules', requireAuth, validate(schema.getOrgParamsSchema), controller.getModules.bind(controller));

module.exports = router;
