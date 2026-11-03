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

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_FILE_BYTES } }).single('file');
const handleUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new BadRequestError(`The file must be under ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it, or remove unused columns.`));
    return next(new BadRequestError(`Upload failed: ${err.message}`));
  });
};

router.use(requireAuth, requireModule('candidate_db'));

// Step 1: upload a spreadsheet, get back what the analyser found (nothing is saved).
// Uses the existing candidates:write permission; a dedicated data_import permission arrives with the commit step.
router.post('/analyse', requirePermission('candidates', 'write'), handleUpload, controller.analyse.bind(controller));

// Step 2: matched, staged preview. Importing into a team needs candidates:write for that team (checked in the service).
router.post('/preview', requirePermission('candidates', 'write'), handleUpload, controller.preview.bind(controller));
router.get('/batches/:id', requirePermission('candidates', 'write'), validate(schema.batchParamsSchema), controller.get.bind(controller));
router.get('/batches/:id/rows', requirePermission('candidates', 'write'), validate(schema.rowsSchema), controller.rows.bind(controller));
router.patch('/batches/:id/decisions', requirePermission('candidates', 'write'), validate(schema.decisionsSchema), controller.decide.bind(controller));
router.delete('/batches/:id', requirePermission('candidates', 'write'), validate(schema.batchParamsSchema), controller.discard.bind(controller));

module.exports = router;
