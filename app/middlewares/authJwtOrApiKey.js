const authJwt = require("./authMiddleware.js");
const resolveApiKey = require("./apiKeyMiddleware.js");

const authJwtOrApiKey = (roles = []) => {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const hasApiKey =
      req.headers["x-api-key"] ||
      /^ApiKey\s+/i.test(authHeader) ||
      (/^Bearer\s+/i.test(authHeader) &&
        authHeader.replace(/^Bearer\s+/i, "").trim().startsWith("lnk_"));

    if (hasApiKey) {
      return resolveApiKey(req, res, next);
    }
    return authJwt(roles)(req, res, next);
  };
};

module.exports = authJwtOrApiKey;
