const express = require('express');
const router = express.Router();
const controller = require('./credits.controller');
const validate = require('../../middlewares/validate');
const schema = require('./credits.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

router.use(requireAuth);

router.get('/balance', requirePermission('credit_account', 'read'), controller.getBalance.bind(controller));
router.get('/transactions', requirePermission('credit_account', 'read'), validate(schema.transactionQuerySchema), controller.listTransactions.bind(controller));

// NOTE: no role in seed.ts grants a credit_account 'write'/'adjust' action — topping up
// and adjusting balances reads as platform-admin territory (billing), not an org-level
// permission at all. Left behind requireAuth only; needs a real platform_admin check
// once platform-scoped auth exists (see walkthrough.md "Known Gaps").
router.post('/top-up', validate(schema.topUpSchema), controller.topUp.bind(controller));
router.post('/adjust', validate(schema.adjustSchema), controller.adjust.bind(controller));

router.get('/costs', controller.listCosts.bind(controller));

module.exports = router;
