const { validateEnv, env } = require('./config/env');

validateEnv();

const app = require('./app');
const { connectDB } = require('./config/db');
const logger = require('./config/logger');

let server;

async function start() {
  try {
    await connectDB();
    server = app.listen(env.PORT, () => {
      logger.info(`Project Doctor AI backend listening on port ${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err.message}`);
  if (server) server.close(() => process.exit(1));
  else process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (server) server.close(() => process.exit(0));
});

start();

module.exports = { start };
