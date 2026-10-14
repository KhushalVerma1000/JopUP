const service = require('./resume-parser.service');
const { BadRequestError } = require('../../utils/errors');

class ResumeParserController {
  async parse(req, res) {
    const files = req.files || [];
    if (!files.length) throw new BadRequestError('Attach at least one resume in the "files" field');

    const defaultCountry = req.query.defaultCountry;
    if (defaultCountry !== undefined && !/^[A-Za-z]{2}$/.test(defaultCountry)) {
      throw new BadRequestError('defaultCountry must be a 2-letter ISO code (e.g. "IN")');
    }

    const results = await service.parseMany(files, { defaultCountry });
    await service.annotateExisting(req.tenantId, results);

    const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, { total: results.length });
    res.json({ status: 'success', data: { summary, results } });
  }

  async bulkCreate(req, res) {
    const results = await service.bulkCreate(req.tenantId, req.user?.userId, req.body);
    const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, { total: results.length });
    res.status(207).json({ status: 'success', data: { summary, results } });
  }
}

module.exports = new ResumeParserController();
