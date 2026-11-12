const service = require('./data-import.service');
const commit = require('./commit.service');
const { BadRequestError } = require('../../utils/errors');

const CLIENT_MODES = ['none', 'sheet', 'name', 'auto'];
/** clientMode / clientName for one file (analyse). */
const clientAsk = (body) => {
  if (body.clientMode === undefined) return {};
  if (!CLIENT_MODES.includes(body.clientMode)) throw new BadRequestError('clientMode must be none, sheet, name or auto');
  const name = body.clientName === undefined ? undefined : String(body.clientName).trim().slice(0, 120);
  return { clientMode: body.clientMode, clientName: name };
};
/** { "<file name>": { mode, name } } for several files (preview). Anything unreadable is a clear error, not a silent skip. */
const fileClientsFrom = (raw) => {
  const v = parseJson(raw, 'fileClients');
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestError('fileClients must be an object keyed by file name');
  const out = {};
  for (const [file, a] of Object.entries(v)) {
    if (!a || !CLIENT_MODES.includes(a.mode)) throw new BadRequestError(`fileClients: "${file}" needs a mode of none, sheet, name or auto`);
    out[file] = { mode: a.mode, name: a.name === undefined || a.name === null ? undefined : String(a.name).trim().slice(0, 120) };
  }
  return out;
};

const parseJson = (raw, label) => {
  if (raw === undefined || raw === '') return undefined;
  try { return JSON.parse(raw); } catch { throw new BadRequestError(`${label} must be valid JSON`); }
};

class DataImportController {
  async analyse(req, res) {
    if (!req.file) throw new BadRequestError('Attach a spreadsheet in the "file" field');
    const body = req.body || {};
    const defaultCountry = body.defaultCountry || req.query.defaultCountry;
    if (defaultCountry !== undefined && !/^[A-Za-z]{2}$/.test(defaultCountry)) {
      throw new BadRequestError('defaultCountry must be a 2-letter ISO code (e.g. "IN")');
    }
    const dateOrder = body.dateOrder;
    if (dateOrder !== undefined && !['dmy', 'mdy'].includes(dateOrder)) throw new BadRequestError('dateOrder must be "dmy" or "mdy"');
    const data = await service.analyseFile(req.file, req.tenantId, {
      defaultCountry: defaultCountry ? defaultCountry.toUpperCase() : undefined,
      dateOrder,
      statusOverrides: parseJson(body.statusOverrides, 'statusOverrides'),
      mappingOverrides: parseJson(body.mappingOverrides, 'mappingOverrides'),
      ...clientAsk(body),
    });
    res.json({ status: 'success', data });
  }

  // Step 2: the same analysis, plus matching against what the team already has. Staged, not committed.
  async preview(req, res) {
    const uploaded = req.files || {};
    const files = [...(uploaded.files || []), ...(uploaded.file || [])];
    if (!files.length) throw new BadRequestError('Attach at least one spreadsheet in the "files" field');
    const body = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(body.teamId || '')) throw new BadRequestError('teamId is required: the team these candidates are being imported into');
    const defaultCountry = body.defaultCountry;
    if (defaultCountry !== undefined && !/^[A-Za-z]{2}$/.test(defaultCountry)) throw new BadRequestError('defaultCountry must be a 2-letter ISO code (e.g. "IN")');
    if (body.dateOrder !== undefined && !['dmy', 'mdy'].includes(body.dateOrder)) throw new BadRequestError('dateOrder must be "dmy" or "mdy"');
    const data = await service.createPreview(req.user, req.tenantId, files, {
      teamId: body.teamId,
      defaultCountry: defaultCountry ? defaultCountry.toUpperCase() : undefined,
      dateOrder: body.dateOrder,
      statusOverrides: parseJson(body.statusOverrides, 'statusOverrides'),
      mappingOverrides: parseJson(body.mappingOverrides, 'mappingOverrides'),
      fileClients: fileClientsFrom(body.fileClients),
    });
    res.status(201).json({ status: 'success', data });
  }

  async get(req, res) {
    res.json({ status: 'success', data: await service.getBatch(req.user, req.tenantId, req.params.id) });
  }

  async rows(req, res) {
    const { filter, page, limit } = req.query;
    res.json({ status: 'success', data: await service.listRows(req.user, req.tenantId, req.params.id, { filter, page, limit }) });
  }

  async decide(req, res) {
    res.json({ status: 'success', data: await service.applyDecisions(req.user, req.tenantId, req.params.id, req.body) });
  }

  // Step 3: write it. start once, then call next until progress.pending is 0.
  async commitStart(req, res) {
    res.json({ status: 'success', data: await commit.startCommit(req.user, req.tenantId, req.params.id, req.body) });
  }

  async commitNext(req, res) {
    res.json({ status: 'success', data: await commit.commitNext(req.user, req.tenantId, req.params.id) });
  }

  async undo(req, res) {
    res.json({ status: 'success', data: await commit.undoBatch(req.user, req.tenantId, req.params.id) });
  }

  async discard(req, res) {
    await service.discardBatch(req.user, req.tenantId, req.params.id);
    res.status(204).end();
  }
}

module.exports = new DataImportController();
