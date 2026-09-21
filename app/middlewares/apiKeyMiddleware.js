const {
  resolveApiKeyRecord,
  consumeDailyQuota,
} = require("../services/apiKeyRuntime.service");

function extractRawApiKey(req) {
  let raw = req.headers["x-api-key"];
  if (!raw) {
    const auth = req.headers.authorization || "";
    if (/^ApiKey\s+/i.test(auth)) {
      raw = auth.replace(/^ApiKey\s+/i, "").trim();
    } else if (/^Bearer\s+/i.test(auth)) {
      const bearer = auth.replace(/^Bearer\s+/i, "").trim();
      if (bearer.startsWith("lnk_")) raw = bearer;
    }
  }
  return raw ? String(raw).trim() : "";
}

function createResolveApiKey({ countUsage = false } = {}) {
  return async (req, res, next) => {
    const raw = extractRawApiKey(req);

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
      }

      req.apiKey = record;
      req.user = { id: record.userId, role: record.role };
      next();
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };
}

const resolveApiKey = createResolveApiKey({ countUsage: false });
resolveApiKey.withUsageCount = createResolveApiKey({ countUsage: true });

module.exports = resolveApiKey;
