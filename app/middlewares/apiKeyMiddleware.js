const { ApiKey, ApiKeyDailyUsage, User } = require("../models");
const { getTodayInVietnam } = require("../utils/date");

const STATUS_ON = 1;

const resolveApiKey = async (req, res, next) => {
  const raw =
    req.headers["x-api-key"] ||
    (req.headers.authorization || "").replace(/^ApiKey\s+/i, "").trim();

  if (!raw) {
    return res.status(401).json({ success: false, message: "API key required" });
  }

  try {
    const record = await ApiKey.findOne({
      where: { keyValue: raw, status: STATUS_ON },
      include: [{ model: User, as: "owner", attributes: ["id", "role", "status"] }],
    });

    if (!record || !record.owner) {
      return res.status(401).json({ success: false, message: "Invalid API key" });
    }

    if (record.owner.status !== 1) {
      return res.status(403).json({ success: false, message: "User account disabled" });
    }

    const statDate = getTodayInVietnam();
    const [usage] = await ApiKeyDailyUsage.findOrCreate({
      where: { apiKeyId: record.id, statDate },
      defaults: {
        userId: record.userId,
        requestCount: 0,
      },
    });

    if (usage.requestCount >= record.dailyLimit) {
      return res.status(429).json({
        success: false,
        message: "Daily request limit exceeded",
        dailyLimit: record.dailyLimit,
        used: usage.requestCount,
        statDate,
      });
    }

    await usage.increment("requestCount");

    req.apiKey = record;
    req.user = { id: record.userId, role: record.owner.role };
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = resolveApiKey;
