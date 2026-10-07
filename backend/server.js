/**
 * Application Entry Point
 *
 * Loads environment variables and starts the Express server.
 */

require('dotenv').config();

const { assertProductionEnv } = require('./src/utils/checkEnv');

// Refuse to boot in production with config that would break emailed links.
assertProductionEnv();

const app = require('./src/app');
const dailyTrackerScheduler = require('./src/features/daily-trackers/daily-trackers.scheduler');
const performanceScheduler = require('./src/features/performance/performance.scheduler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 JopUP server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  dailyTrackerScheduler.start();
  performanceScheduler.start();
});
