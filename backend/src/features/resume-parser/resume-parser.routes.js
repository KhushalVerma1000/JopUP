const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('./resume-parser.controller');
const validate = require('../../middlewares/validate');
const schema = require('./resume-parser.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');
const requireLimit = require('../../middlewares/requireLimit');
const { BadRequestError } = require('../../utils/errors');

const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
  // Unsupported types are not rejected here: they come back as a per-file
  // "failed" row so one stray file does not discard the whole batch.
}).array('files', MAX_FILES);

const handleUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new BadRequestError(`Each file must be under ${MAX_FILE_BYTES / 1024 / 1024} MB`));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(new BadRequestError(`Upload up to ${MAX_FILES} files per request in the "files" field`));
    return next(new BadRequestError(`Upload failed: ${err.message}`));
  });
};

router.use(requireAuth, requireModule('candidate_db'));

// Step 1: upload resumes, get parsed drafts back (nothing is saved).
router.post('/parse', requirePermission('candidates', 'write'), handleUpload, controller.parse.bind(controller));
// Step 2: send the reviewed drafts, candidates are created.
router.post('/bulk-create', requirePermission('candidates', 'write'), validate(schema.bulkCreateSchema), requireLimit('max_candidates', (req) => req.body.items.length), controller.bulkCreate.bind(controller));

module.exports = router;
