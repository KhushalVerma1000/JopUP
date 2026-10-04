const service = require('./daily-trackers.service');
const { canSeeTeam } = require('../../utils/teamScope');
const { ForbiddenError } = require('../../utils/errors');

class DailyTrackersController {
  async overview(req, res) {
    const data = await service.overview(req.tenantId, req.user, req.query);
    res.json({ status: 'success', data });
  }

  async listSchedules(req, res) {
    const schedules = await service.listSchedules(req.tenantId, req.user, req.query);
    res.json({ status: 'success', data: { schedules } });
  }

  async createSchedule(req, res) {
    if (!canSeeTeam(req.user, req.body.teamId)) throw new ForbiddenError("You don't have access to that team");
    const schedule = await service.createSchedule(req.tenantId, req.body, req.user.userId);
    res.status(201).json({ status: 'success', data: { schedule } });
  }

  async updateSchedule(req, res) {
    const schedule = await service.updateSchedule(req.tenantId, req.params.id, req.body, req.user.userId, req.user);
    res.json({ status: 'success', data: { schedule } });
  }

  async deleteSchedule(req, res) {
    await service.deleteSchedule(req.tenantId, req.params.id, req.user.userId, req.user);
    res.status(204).send();
  }

  /** "Send now": today's tracker, right away, regardless of the schedule's time or enabled flag. */
  async sendNow(req, res) {
    await service.getScheduleOrThrow(req.tenantId, req.params.id, req.user);
    const { run, alreadyRan } = await service.runSchedule(req.params.id, { trigger: 'manual', userId: req.user.userId });
    res.json({ status: 'success', data: { run, alreadyRan: !!alreadyRan } });
  }

  async listRuns(req, res) {
    const runs = await service.listRuns(req.tenantId, req.params.id, req.user);
    res.json({ status: 'success', data: { runs } });
  }
}

module.exports = new DailyTrackersController();
