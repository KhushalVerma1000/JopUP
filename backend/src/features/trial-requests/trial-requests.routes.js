const express = require('express');
const router = express.Router();
const controller = require('./trial-requests.controller');
const validate = require('../../middlewares/validate');
const schema = require('./trial-requests.schema');
const { planRequestLimiter } = require('../../middlewares/rateLimit');

// Public on purpose: the form is on the signup page and in the app. Rate-limited per IP.
router.post('/', planRequestLimiter, validate(schema.createRequestSchema), controller.create.bind(controller));

module.exports = router;
