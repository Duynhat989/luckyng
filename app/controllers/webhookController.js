const { Webhook } = require("../models");
const { dbQueue } = require("../utils/dbQueue");
const { invalidateWebhookCache } = require("../services/webhookRuntime.service");

const STATUS_ON = 1;
const STATUS_OFF = 2;

function isValidUrl(raw) {
  const s = String(raw || "").trim();
  if (s.length < 8) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

exports.create = async (req, res) => {
  try {
    const { label, url, headerApiKey } = req.body;
    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        message: "URL webhook không hợp lệ (cần http/https)",
      });
    }

    const row = await dbQueue.add(() =>
      Webhook.create({
        userId: req.user.id,
        label: label || `Webhook ${new Date().toISOString().slice(0, 10)}`,
        url: String(url).trim(),
        headerApiKey: headerApiKey ? String(headerApiKey).trim() : null,
        status: STATUS_ON,
      })
    );
    invalidateWebhookCache();

    return res.status(201).json({
      success: true,
      data: {
        id: row.id,
        label: row.label,
        url: row.url,
        headerApiKey: row.headerApiKey,
        status: row.status,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.list = async (req, res) => {
  try {
    const rows = await dbQueue.add(() =>
      Webhook.findAll({
        where: { userId: req.user.id },
        order: [["createdAt", "DESC"]],
      })
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, url, headerApiKey, status } = req.body;
    const row = await dbQueue.add(() =>
      Webhook.findOne({ where: { id, userId: req.user.id } })
    );
    if (!row) {
      return res.status(404).json({ success: false, message: "Webhook not found" });
    }

    if (label !== undefined) row.label = label;
    if (url !== undefined) {
      if (!isValidUrl(url)) {
        return res.status(400).json({
          success: false,
          message: "URL webhook không hợp lệ (cần http/https)",
        });
      }
      row.url = String(url).trim();
    }
    if (headerApiKey !== undefined) {
      row.headerApiKey = headerApiKey ? String(headerApiKey).trim() : null;
    }
    if (status !== undefined) {
      const s = parseInt(status, 10);
      if ([STATUS_ON, STATUS_OFF].includes(s)) row.status = s;
    }

    await dbQueue.add(() => row.save());
    invalidateWebhookCache();

    return res.status(200).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dbQueue.add(() =>
      Webhook.findOne({ where: { id, userId: req.user.id } })
    );
    if (!row) {
      return res.status(404).json({ success: false, message: "Webhook not found" });
    }
    await dbQueue.add(() => row.destroy());
    invalidateWebhookCache();
    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
