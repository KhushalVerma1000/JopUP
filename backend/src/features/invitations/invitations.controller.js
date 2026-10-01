const service = require('./invitations.service');

class InvitationsController {
  async create(req, res) {
    const { invitation, emailSent } = await service.create(req.tenantId, req.user.userId, req.body);
    res.status(201).json({
      status: 'success',
      message: emailSent
        ? `Invitation sent to ${invitation.email}.`
        : 'Invitation created, but the email could not be delivered. Check the email configuration, then revoke and re-invite.',
      data: { invitation, emailSent },
    });
  }

  async list(req, res) {
    const { status } = req.query;
    const invitations = await service.list(req.tenantId, status);
    res.json({ status: 'success', data: { invitations } });
  }

  async revoke(req, res) {
    const invitation = await service.revoke(req.tenantId, req.params.id, req.user.userId);
    res.json({ status: 'success', data: { invitation } });
  }

  async accept(req, res) {
    const { token, user, roles } = await service.accept(req.body);
    res.status(201).json({ status: 'success', data: { token, user, roles } });
  }
}

module.exports = new InvitationsController();
