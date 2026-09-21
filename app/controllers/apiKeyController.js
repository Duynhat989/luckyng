const crypto = require("crypto");
const { Op, fn, col } = require("sequelize");
const { ApiKey, ApiKeyDailyUsage, User } = require("../models");
const { getTodayInVietnam } = require("../utils/date");

const STATUS_ON = 1;
const STATUS_OFF = 2;

function generateKeyValue() {
  return `lnk_${crypto.randomBytes(24).toString("hex")}`;
}

exports.create = async (req, res) => {
  try {
    const { userId, label, dailyLimit = 1000 } = req.body;
    const uid = parseInt(userId, 10);
    if (!uid) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const user = await User.findByPk(uid);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const limit = Math.max(1, parseInt(dailyLimit, 10) || 1000);
    const keyValue = generateKeyValue();

    const row = await ApiKey.create({
      userId: uid,
      label: label || `Key for ${user.email}`,
      keyValue,
      dailyLimit: limit,
      status: STATUS_ON,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: row.id,
        label: row.label,
        keyValue: row.keyValue,
        userId: row.userId,
        dailyLimit: row.dailyLimit,
        status: row.status,
        user: { id: user.id, name: user.name, email: user.email },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.list = async (req, res) => {
  try {
    const today = getTodayInVietnam();
    const keys = await ApiKey.findAll({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "name", "email", "phone"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const ids = keys.map((k) => k.id);
    const usages =
      ids.length === 0
        ? []
        : await ApiKeyDailyUsage.findAll({
            where: { apiKeyId: { [Op.in]: ids }, statDate: today },
          });
    const usageMap = Object.fromEntries(usages.map((u) => [u.apiKeyId, u.requestCount]));

    const data = keys.map((k) => ({
      id: k.id,
      label: k.label,
      keyValue: k.keyValue,
      userId: k.userId,
      dailyLimit: k.dailyLimit,
      status: k.status,
      createdAt: k.createdAt,
      owner: k.owner,
      todayUsage: usageMap[k.id] || 0,
    }));

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, dailyLimit, status } = req.body;
    const row = await ApiKey.findByPk(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "API key not found" });
    }

    if (label !== undefined) row.label = label;
    if (dailyLimit !== undefined) {
      row.dailyLimit = Math.max(1, parseInt(dailyLimit, 10) || row.dailyLimit);
    }
    if (status !== undefined) {
      const s = parseInt(status, 10);
      if ([STATUS_ON, STATUS_OFF].includes(s)) row.status = s;
    }
    await row.save();

    return res.status(200).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await ApiKey.findByPk(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "API key not found" });
    }
    await ApiKeyDailyUsage.destroy({ where: { apiKeyId: row.id } });
    await row.destroy();
    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.statsByUserDay = async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    const today = getTodayInVietnam();
    const dateFrom = from || today;
    const dateTo = to || today;

    const where = {
      statDate: { [Op.between]: [dateFrom, dateTo] },
    };
    if (userId) {
      where.userId = parseInt(userId, 10);
    }

    const aggregated = await ApiKeyDailyUsage.findAll({
      where,
      attributes: [
        "userId",
        "statDate",
        [fn("SUM", col("requestCount")), "requestCount"],
      ],
      group: ["userId", "statDate"],
      order: [["statDate", "DESC"]],
      raw: true,
    });

    const userIds = [...new Set(aggregated.map((r) => r.userId))];
    const users = userIds.length
      ? await User.findAll({
          where: { id: { [Op.in]: userIds } },
          attributes: ["id", "name", "email"],
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const data = aggregated.map((r) => ({
      userId: r.userId,
      statDate: r.statDate,
      requestCount: parseInt(r.requestCount, 10) || 0,
      user: userMap[r.userId] || null,
    }));

    return res.status(200).json({
      success: true,
      data,
      range: { from: dateFrom, to: dateTo },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.statsByKeyDay = async (req, res) => {
  try {
    const { from, to, apiKeyId } = req.query;
    const today = getTodayInVietnam();
    const dateFrom = from || today;
    const dateTo = to || today;

    const where = {
      statDate: { [Op.between]: [dateFrom, dateTo] },
    };
    if (apiKeyId) {
      where.apiKeyId = parseInt(apiKeyId, 10);
    }

    const rows = await ApiKeyDailyUsage.findAll({
      where,
      include: [
        {
          model: ApiKey,
          as: "apiKey",
          attributes: ["id", "label", "keyValue", "dailyLimit"],
        },
        {
          model: User,
          as: "owner",
          attributes: ["id", "name", "email"],
        },
      ],
      order: [
        ["statDate", "DESC"],
        ["requestCount", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      data: rows,
      range: { from: dateFrom, to: dateTo },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
