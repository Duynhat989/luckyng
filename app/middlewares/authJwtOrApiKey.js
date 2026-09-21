const auth = require("./authMiddleware.js");
const resolveApiKey = require("./apiKeyMiddleware.js");

const authJwtOrApiKey = (roles = []) => {
  return (req, res, next) => {
    const hasApiKey =
      req.headers["x-api-key"] ||
      /^ApiKey\s+/i.test(req.headers.authorization || "");

    if (hasApiKey) {
      return resolveApiKey(req, res, next);
    }
    return auth(roles)(req, res, next);
  };
};

module.exports = authJwtOrApiKey;
