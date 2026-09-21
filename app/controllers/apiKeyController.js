const crypto = require("crypto");
const { Op, fn, col } = require("sequelize");
const { ApiKey, ApiKeyDailyUsage, User } = require("../models");
const { getTodayInVietnam } = require("../utils/date");
const { dbQueue } = require("../utils/dbQueue");
const {
  invalidateAllKeyCache,
  invalidateKeyCache,
  scheduleFlushUsageNow,
  getLiveUsageCount,
} = require("../services/apiKeyRuntime.service");

const STATUS_ON = 1;
const STATUS_OFF = 2;

function getMaxRequestPerDay() {
  const n = parseInt(process.env.MAX_REQUEST_PER_DAY, 10);
  return Number.isFinite(n) && n > 0 ? n : 150000;
}

async function sumAllDailyLimits(excludeKeyId = null) {
  return dbQueue.add(async () => {
    const where = excludeKeyId ? { id: { [Op.ne]: excludeKeyId } } : {};
    const total = await ApiKey.sum("dailyLimit", { where });
    return total || 0;
  });
}

async function validateTotalDailyLimit(newLimit, excludeKeyId = null) {
  const max = getMaxRequestPerDay();
  const othersSum = await sumAllDailyLimits(excludeKeyId);
  const projected = othersSum + newLimit;
  if (projected > max) {
    return {
      valid: false,
      max,
      othersSum,
      projected,
      remaining: Math.max(0, max - othersSum),
    };
  }
  return { valid: true, max, othersSum, remaining: max - projected };
}

function generateKeyValue() {
  return `lnk_${crypto.randomBytes(24).toString("hex")}`;
}

async function getQuotaPayload() {
  const max = getMaxRequestPerDay();
  const allocated = await sumAllDailyLimits();
  return {
    maxPerDay: max,
    allocated,
    remaining: Math.max(0, max - allocated),
  };
}

exports.create = async (req, res) => {
  try {
    const { label, dailyLimit = 1000 } = req.body;
    const uid = req.user.id;

    const user = await User.findByPk(uid);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const limit = Math.max(1, parseInt(dailyLimit, 10) || 1000);
    const check = await validateTotalDailyLimit(limit);
    if (!check.valid) {
      return res.status(400).json({
        success: false,
        message: `Tổng giới hạn/ngày của tất cả key không được vượt ${check.max.toLocaleString("vi-VN")}`,
        quota: {
          maxPerDay: check.max,
          allocated: check.othersSum,
          remaining: check.remaining,
          requested: limit,
        },
      });
    }

    const keyValue = generateKeyValue();

    const row = await dbQueue.add(() =>
      ApiKey.create({
        userId: uid,
        label: label || `API key ${new Date().toISOString().slice(0, 10)}`,
        keyValue,
        dailyLimit: limit,
        status: STATUS_ON,
      })
    );
    invalidateAllKeyCache();

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
    scheduleFlushUsageNow();
    const today = getTodayInVietnam();
    const keys = await dbQueue.add(() =>
      ApiKey.findAll({
      where: { userId: req.user.id },
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "name", "email", "phone"],
        },
      ],
      order: [["createdAt", "DESC"]],
      })
    );

    const ids = keys.map((k) => k.id);
    const usages =
      ids.length === 0
        ? []
        : await dbQueue.add(() =>
            ApiKeyDailyUsage.findAll({
              where: { apiKeyId: { [Op.in]: ids }, statDate: today },
            })
          );
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
      todayUsage: getLiveUsageCount(k.id, today) ?? usageMap[k.id] ?? 0,
    }));

    const quota = await getQuotaPayload();
    return res.status(200).json({ success: true, data, quota });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, dailyLimit, status } = req.body;
    const row = await dbQueue.add(() =>
      ApiKey.findOne({ where: { id, userId: req.user.id } })
    );
    if (!row) {
      return res.status(404).json({ success: false, message: "API key not found" });
    }

    if (label !== undefined) row.label = label;
    if (dailyLimit !== undefined) {
      const nextLimit = Math.max(1, parseInt(dailyLimit, 10) || row.dailyLimit);
      const check = await validateTotalDailyLimit(nextLimit, row.id);
      if (!check.valid) {
        return res.status(400).json({
          success: false,
          message: `Tổng giới hạn/ngày của tất cả key không được vượt ${check.max.toLocaleString("vi-VN")}`,
          quota: {
            maxPerDay: check.max,
            allocatedOthers: check.othersSum,
            remaining: check.remaining,
            requested: nextLimit,
          },
        });
      }
      row.dailyLimit = nextLimit;
    }
    if (status !== undefined) {
      const s = parseInt(status, 10);
      if ([STATUS_ON, STATUS_OFF].includes(s)) row.status = s;
    }
    await dbQueue.add(() => row.save());
    invalidateKeyCache(row.keyValue);

    return res.status(200).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dbQueue.add(() =>
      ApiKey.findOne({ where: { id, userId: req.user.id } })
    );
    if (!row) {
      return res.status(404).json({ success: false, message: "API key not found" });
    }
    await dbQueue.add(async () => {
      await ApiKeyDailyUsage.destroy({ where: { apiKeyId: row.id } });
      await row.destroy();
    });
    invalidateKeyCache(row.keyValue);
    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.statsByUserDay = async (req, res) => {
  try {
    const { from, to } = req.query;
    const today = getTodayInVietnam();
    const dateFrom = from || today;
    const dateTo = to || today;

    const where = {
      statDate: { [Op.between]: [dateFrom, dateTo] },
      userId: req.user.id,
    };

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

    const adminKeyIds = (
      await ApiKey.findAll({
        where: { userId: req.user.id },
        attributes: ["id"],
      })
    ).map((k) => k.id);

    if (!adminKeyIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
        range: { from: dateFrom, to: dateTo },
      });
    }

    const where = {
      statDate: { [Op.between]: [dateFrom, dateTo] },
      userId: req.user.id,
      apiKeyId: apiKeyId ? parseInt(apiKeyId, 10) : { [Op.in]: adminKeyIds },
    };

    const rows = await ApiKeyDailyUsage.findAll({
      where,
      include: [
        {
          model: ApiKey,
          as: "apiKey",
          attributes: ["id", "label", "keyValue", "dailyLimit"],
          where: { userId: req.user.id },
          required: true,
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
