const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middlewares/requireAuth');
const service = require('./billing.service');

router.use(requireAuth);

// Any signed-in member can see their workspace's plan and usage (read-only).
router.get('/usage', async (req, res) => {
  const data = await service.getUsage(req.tenantId);
  res.json({ status: 'success', data });
});

module.exports = router;
