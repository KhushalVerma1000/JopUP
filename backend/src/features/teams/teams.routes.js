const express = require('express');
const router = express.Router();
const controller = require('./teams.controller');
const validate = require('../../middlewares/validate');
const schema = require('./teams.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

router.use(requireAuth);

// 'teams' (create/edit/delete a team) is an org_admin-only permission in the
// seed data; managers only hold 'team_members:read' on their own team, so a
// plain GET stays open to any authenticated staff member of the org.
router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getTeamParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('teams', 'write'), validate(schema.createTeamSchema), controller.create.bind(controller));
router.patch('/:id', requirePermission('teams', 'write'), validate(schema.updateTeamSchema), controller.update.bind(controller));
router.delete('/:id', requirePermission('teams', 'delete'), validate(schema.getTeamParamsSchema), controller.remove.bind(controller));

module.exports = router;
