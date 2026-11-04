const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('./data-import.controller');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');
const validate = require('../../middlewares/validate');
const schema = require('./data-import.schema');
const { BadRequestError } = require('../../utils/errors');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const { MAX_FILES } = require('./combine');

const limits = { files: MAX_FILES, fileSize: MAX_FILE_BYTES };
const uploadError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') return new BadRequestError(`Each file must be under ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it, or remove unused columns.`);
  if (err.code === 'LIMIT_FILE_COUNT') return new BadRequestError(`Import up to ${MAX_FILES} files at a time.`);
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return new BadRequestError('Attach the spreadsheets in the "files" field (or "file" for one).');
  return new BadRequestError(`Upload failed: ${err.message}`);
};
const wrap = (mw) => (req, res, next) => mw(req, res, (err) => (err ? next(uploadError(err)) : next()));

// /analyse reads one file at a time (the wizard calls it once per file)
const handleUpload = wrap(multer({ storage: multer.memoryStorage(), limits: { ...limits, files: 1 } }).single('file'));
// /preview takes one or many: "files" (repeat the field), or the original single "file"
const handleUploadMany = wrap(multer({ storage: multer.memoryStorage(), limits }).fields([{ name: 'files', maxCount: MAX_FILES }, { name: 'file', maxCount: 1 }]));

router.use(requireAuth, requireModule('candidate_db'));

// Step 1: upload a spreadsheet, get back what the analyser found (nothing is saved).
// Uses the existing candidates:write permission; a dedicated data_import permission arrives with the commit step.
router.post('/analyse', requirePermission('candidates', 'write'), handleUpload, controller.analyse.bind(controller));

// Step 2: matched, staged preview of one or several files as ONE batch. Importing into a team needs candidates:write for that team (checked in the service).
router.post('/preview', requirePermission('candidates', 'write'), handleUploadMany, controller.preview.bind(controller));
router.get('/batches/:id', requirePermission('candidates', 'write'), validate(schema.batchParamsSchema), controller.get.bind(controller));
router.get('/batches/:id/rows', requirePermission('candidates', 'write'), validate(schema.rowsSchema), controller.rows.bind(controller));
router.patch('/batches/:id/decisions', requirePermission('candidates', 'write'), validate(schema.decisionsSchema), controller.decide.bind(controller));
// Step 3: writing needs tracker access as well as candidate access (checked again per team in the service).
router.post('/batches/:id/commit', requirePermission('candidates', 'write'), requirePermission('trackers', 'write'), validate(schema.commitSchema), controller.commitStart.bind(controller));
router.post('/batches/:id/commit/next', requirePermission('candidates', 'write'), requirePermission('trackers', 'write'), validate(schema.batchParamsSchema), controller.commitNext.bind(controller));
router.post('/batches/:id/undo', requirePermission('candidates', 'write'), requirePermission('trackers', 'write'), validate(schema.batchParamsSchema), controller.undo.bind(controller));
router.delete('/batches/:id', requirePermission('candidates', 'write'), validate(schema.batchParamsSchema), controller.discard.bind(controller));

module.exports = router;
