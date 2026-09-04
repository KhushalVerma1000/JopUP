const express = require('express');
const router = express.Router();
const controller = require('./credits.controller');
const validate = require('../../middlewares/validate');
const schema = require('./credits.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

router.use(requireAuth);

router.get('/balance', requirePermission('credit_account', 'read'), controller.getBalance.bind(controller));
router.get('/transactions', requirePermission('credit_account', 'read'), validate(schema.transactionQuerySchema), controller.listTransactions.bind(controller));

// Only platform_admin has credit_account:write/adjust in seed.ts (patch 4 also
// fixed a key mismatch here — platform_admin previously used "credit_accounts",
// plural, which could never match this check). No org-scoped role — including
// org_admin — can top up or adjust a balance; that's billing/platform territory
// by design, not an oversight.
router.post('/top-up', requirePermission('credit_account', 'write'), validate(schema.topUpSchema), controller.topUp.bind(controller));
router.post('/adjust', requirePermission('credit_account', 'adjust'), validate(schema.adjustSchema), controller.adjust.bind(controller));

router.get('/costs', controller.listCosts.bind(controller));

module.exports = router;
