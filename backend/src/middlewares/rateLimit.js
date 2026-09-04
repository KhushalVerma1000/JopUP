const rateLimit = require('express-rate-limit');

// Applied per-IP. Login is the more sensitive of the two (credential
// stuffing / brute force against a known email), so it gets a tighter
// window. Both are deliberately generous enough not to annoy a real user
// who mistypes a password a couple of times, while still bounding an
// automated attempt at scale.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many login attempts. Please try again in a few minutes.',
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many registration attempts from this address. Please try again later.',
  },
});

module.exports = { loginLimiter, registerLimiter };
