const ApiError = require('../utils/ApiError');

// Returns middleware that validates `req[property]` against a Joi schema.
// Usage: router.post('/x', validate(schema), controller)
const validate = (schema, property = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map((d) => d.message);
    return next(ApiError.badRequest('Validation failed', details));
  }

  req[property] = value;
  next();
};

module.exports = validate;
