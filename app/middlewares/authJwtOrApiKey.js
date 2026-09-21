const authJwt = require("./authMiddleware.js");
const resolveApiKey = require("./apiKeyMiddleware.js");

const authJwtOrApiKey = (roles = [], options = {}) => {
  const countUsage = options.countUsage === true;
  const apiKeyMw = countUsage ? resolveApiKey.withUsageCount : resolveApiKey;

  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const hasApiKey =
      req.headers["x-api-key"] ||
      /^ApiKey\s+/i.test(authHeader) ||
      (/^Bearer\s+/i.test(authHeader) &&
        authHeader.replace(/^Bearer\s+/i, "").trim().startsWith("lnk_"));

    if (hasApiKey) {
      return apiKeyMw(req, res, next);
    }
    return authJwt(roles)(req, res, next);
  };
};

module.exports = authJwtOrApiKey;
