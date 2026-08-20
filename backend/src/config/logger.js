const winston = require('winston');
const { env } = require('./env');

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple())
  ),
  defaultMeta: { service: 'project-doctor-ai' },
  transports: [new winston.transports.Console()],
  silent: env.NODE_ENV === 'test',
});

module.exports = logger;
