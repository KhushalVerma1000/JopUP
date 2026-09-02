const express = require('express');
const router = express.Router();
const controller = require('./auth.controller');
const validate = require('../../middlewares/validate');
const schema = require('./auth.schema');

// Public — staff self-registration (creates a 'pending_approval' account)
router.post('/register', validate(schema.registerStaffSchema), controller.registerStaff.bind(controller));

// Public — staff login (rejects anything other than 'active' accounts)
router.post('/login', validate(schema.loginStaffSchema), controller.login.bind(controller));

module.exports = router;
