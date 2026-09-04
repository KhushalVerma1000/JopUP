const express = require('express');
const router = express.Router();
const controller = require('./organization.controller');
const validate = require('../../middlewares/validate');
const schema = require('./organization.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

// POST stays public — this is tenant signup (creating a brand-new organisation),
// not an action an existing staff member performs.
router.post('/', validate(schema.createOrganizationSchema), controller.create.bind(controller));

// 'organisations' read/write is platform_admin-only in seed.ts. requirePermission
// works here the same way it does for any other role — it just checks the roles
// embedded in the caller's JWT — so this is a real restriction as soon as a
// platform_admin user exists, even though there's no dedicated platform-admin
// *login* flow yet. Provisioning that first platform_admin user still has to
// happen out-of-band (direct DB insert into user_team_role with team_id NULL);
// there is no self-registration or invite path to that role, intentionally.
router.get('/', requireAuth, requirePermission('organisations', 'read'), controller.list.bind(controller));
router.get('/:id', requireAuth, requirePermission('organisations', 'read'), validate(schema.getOrgParamsSchema), controller.getById.bind(controller));
router.patch('/:id', requireAuth, requirePermission('organisations', 'write'), validate(schema.updateOrganizationSchema), controller.update.bind(controller));
router.get('/:id/modules', requireAuth, requirePermission('organisations', 'read'), validate(schema.getOrgParamsSchema), controller.getModules.bind(controller));

module.exports = router;
