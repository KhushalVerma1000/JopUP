const { Router } = require('express');
const validate = require('../../middlewares/validate');
const controller = require('./portal.controller');
const jwt = require('jsonwebtoken');
const { UnauthorizedError } = require('../../utils/errors');
const {
  registerJobSeekerSchema,
  loginJobSeekerSchema,
  submitPortalApplicationSchema,
} = require('./portal.schema');

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-here';

function requireSeekerAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid authorization header'));
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'job_seeker') {
      return next(new UnauthorizedError('Access restricted to job seekers'));
    }
    req.seeker = decoded;
    next();
  } catch (err) {
    return next(new UnauthorizedError('Token is invalid or expired'));
  }
}

const router = Router();

// Public routes
router.get('/jobs', controller.listJobs.bind(controller));
router.get('/jobs/:id', controller.getJobById.bind(controller));
router.post('/register', validate(registerJobSeekerSchema), controller.register.bind(controller));
router.post('/login', validate(loginJobSeekerSchema), controller.login.bind(controller));

// Protected routes (Job seekers only)
router.post('/apply', requireSeekerAuth, validate(submitPortalApplicationSchema), controller.apply.bind(controller));

module.exports = router;
