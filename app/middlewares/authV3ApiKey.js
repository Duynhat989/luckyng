const {
  resolveApiKeyRecord,
  consumeDailyQuota,
} = require("../services/apiKeyRuntime.service");

function extractV3ApiKey(req) {
  const headerKey = req.headers["x-api-key"];
  if (headerKey) return String(headerKey).trim();

  const auth = req.headers.authorization || "";
  if (/^ApiKey\s+/i.test(auth)) {
    return auth.replace(/^ApiKey\s+/i, "").trim();
  }
  if (/^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token.startsWith("lnk_")) return token;
  }
  return "";
}

/**
 * @param {number[]} roles
 * @param {{ countUsage?: boolean }} options — countUsage=true: đếm + giới hạn /ngày
 */
const authV3ApiKey = (roles = [], options = {}) => {
  const countUsage = options.countUsage === true;

  return async (req, res, next) => {
    if (typeof roles === "number") roles = [roles];

    const raw = extractV3ApiKey(req);
    if (!raw) {
      return res.status(401).json({ success: false, message: "API key required" });
    }

    try {
      const record = await resolveApiKeyRecord(raw);
      if (!record) {
        return res.status(401).json({ success: false, message: "Invalid API key" });
      }
      if (record.userStatus !== 1) {
        return res.status(403).json({ success: false, message: "User account disabled" });
      }
      if (roles.length && !roles.includes(record.role)) {
        return res.status(403).json({ success: false, message: "Not forbidden" });
      }

      if (countUsage) {
        const quota = consumeDailyQuota(
          record.id,
          record.userId,
          record.dailyLimit
        );
        if (!quota.ok) {
          return res.status(429).json({
            success: false,
            message: "Daily request limit exceeded",
            dailyLimit: quota.dailyLimit,
            used: quota.used,
            statDate: quota.statDate,
          });
        }
        req.quota = quota;
      }

      req.apiKey = record;
      req.user = {
        id: record.userId,
        role: record.role,
        token: raw,
      };
      next();
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };
};

module.exports = authV3ApiKey;
