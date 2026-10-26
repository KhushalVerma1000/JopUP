const service = require('./resume-parser.service');
const { BadRequestError } = require('../../utils/errors');

const { reserveResumeParses } = require('../../utils/quotas');

class ResumeParserController {
  async parse(req, res) {
    const files = req.files || [];
    if (!files.length) throw new BadRequestError('Attach at least one resume in the "files" field');

    const defaultCountry = req.query.defaultCountry;
    if (defaultCountry !== undefined && !/^[A-Za-z]{2}$/.test(defaultCountry)) {
      throw new BadRequestError('defaultCountry must be a 2-letter ISO code (e.g. "IN")');
    }

    // Free, but metered: reserve the whole upload against the monthly allowance
    // (403 PARSE_QUOTA if it doesn't fit), then hand back files that failed.
    const quota = await reserveResumeParses(req.tenantId, files.length);
    let results;
    try {
      results = await service.parseMany(files, { defaultCountry });
    } catch (err) {
      if (quota) await quota.release(files.length).catch(() => {});
      throw err;
    }
    if (quota) await quota.release(results.filter((r) => r.status === 'failed').length).catch(() => {});
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
