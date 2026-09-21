const { sequelize } = require("../config/config");

const { ROLES, User } = require('../models/userModel');
const { STATUS, Setup } = require('../models/setupModel');
const { packs } = require("./packModel");
const { ApiKey } = require("./apiKeyModel");
const { ApiKeyDailyUsage } = require("./apiKeyUsageModel");
const { Webhook } = require("./webhookModel");

User.hasOne(packs, { foreignKey: "userId", as: "pack" });
packs.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(ApiKey, { foreignKey: "userId", as: "apiKeys" });
ApiKey.belongsTo(User, { foreignKey: "userId", as: "owner" });

ApiKey.hasMany(ApiKeyDailyUsage, { foreignKey: "apiKeyId", as: "dailyUsage" });
ApiKeyDailyUsage.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "apiKey" });
ApiKeyDailyUsage.belongsTo(User, { foreignKey: "userId", as: "owner" });

User.hasMany(Webhook, { foreignKey: "userId", as: "webhooks" });
Webhook.belongsTo(User, { foreignKey: "userId", as: "owner" });

const { ensureDefaultAdmin } = require("../bootstrap/ensureAdmin");

sequelize.sync({ force: false }).then(async () => {
  console.log('Database đã được đồng bộ!');
  try {
    await ensureDefaultAdmin();
  } catch (err) {
    console.error("[bootstrap] Lỗi tạo admin mặc định:", err.message);
  }
});
module.exports = {
  User,
  ROLES,
  STATUS,
  Setup,
  packs,
  ApiKey,
  ApiKeyDailyUsage,
  Webhook,
};
