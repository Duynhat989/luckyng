const {
  resolveApiKeyRecord,
  consumeDailyQuota,
} = require("../services/apiKeyRuntime.service");

const resolveApiKey = async (req, res, next) => {
  const raw =
    req.headers["x-api-key"] ||
    (req.headers.authorization || "").replace(/^ApiKey\s+/i, "").trim();

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

    req.apiKey = record;
    req.user = { id: record.userId, role: record.role };
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = resolveApiKey;
