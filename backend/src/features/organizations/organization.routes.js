const express = require('express');
const router = express.Router();
const controller = require('./organization.controller');
const validate = require('../../middlewares/validate');
const schema = require('./organization.schema');
const { requireAuth, requirePermission, requireOrgRole } = require('../../middlewares/requireAuth');

// POST stays public — this is tenant signup (creating a brand-new organisation),
// not an action an existing staff member performs.
router.post('/', validate(schema.createOrganizationSchema), controller.create.bind(controller));

// Self-service — org_admin has no seeded 'organisations' permission key
// (that key is platform_owner/platform_admin only, for managing *other*
// orgs), so an org_admin previously had no way to view or edit their own
// org's profile at all. These three routes close that gap without touching
// the platform-admin-only routes below. Must be registered before '/:id' or
// Express would try to parse "me" as a UUID param.
router.get('/me', requireAuth, controller.getMine.bind(controller));
router.get('/me/modules', requireAuth, controller.getMyModules.bind(controller));
router.patch(
  '/me',
  requireAuth,
  requireOrgRole('org_admin'),
  validate(schema.updateOwnOrganizationSchema),
  controller.updateMine.bind(controller)
);

// Public discovery for the login/register flows — no requireAuth. Must be
// registered before '/:id' below, same reason as '/me': otherwise Express
// would try to match "by-slug" itself as the :id param. See
// organization.service.js's getPublicOrgBySlug/getPublicTeamsBySlug for
// exactly what these do and don't expose.
router.get('/by-slug/:slug', validate(schema.slugParamSchema), controller.getBySlug.bind(controller));
router.get('/by-slug/:slug/teams', validate(schema.slugParamSchema), controller.getTeamsBySlug.bind(controller));

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
