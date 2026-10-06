const analytics = require('./analytics.service');
const { visibleTeamIds, canSeeTeam } = require('../../utils/teamScope');
const { ForbiddenError } = require('../../utils/errors');

class AnalyticsController {
  async pipeline(req, res) {
    const { teamId, days, stuckAfterDays } = req.query;
    if (teamId && !canSeeTeam(req.user, teamId)) throw new ForbiddenError('You don\'t have access to that team');
    const data = await analytics.getPipeline(req.tenantId, { teamIds: visibleTeamIds(req.user), teamId, days, stuckAfterDays });
    res.json({ status: 'success', data });
  }
}

module.exports = new AnalyticsController();
