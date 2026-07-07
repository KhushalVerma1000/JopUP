const express = require('express');
const router = express.Router();
const controller = require('./credits.controller');
const validate = require('../../middlewares/validate');
const schema = require('./credits.schema');

router.get('/balance', controller.getBalance.bind(controller));
router.get('/transactions', validate(schema.transactionQuerySchema), controller.listTransactions.bind(controller));

// Require admin or specific permissions in real app
router.post('/top-up', validate(schema.topUpSchema), controller.topUp.bind(controller));
router.post('/adjust', validate(schema.adjustSchema), controller.adjust.bind(controller));

router.get('/costs', controller.listCosts.bind(controller));

module.exports = router;
