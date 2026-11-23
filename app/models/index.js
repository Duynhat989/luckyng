const { sequelize } = require("../config/config");

const { ROLES, User } = require('../models/userModel');
const { STATUS, Setup } = require('../models/setupModel');
const { packs } = require("./packModel");
const { ApiKey } = require("./apiKeyModel");
const { ApiKeyDailyUsage } = require("./apiKeyUsageModel");
const { Webhook } = require("./webhookModel");
const { RequestData } = require("./requestDataModel");
const { V3TaskResult } = require("./v3TaskResultModel");

User.hasOne(packs, { foreignKey: "userId", as: "pack" });
packs.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(ApiKey, { foreignKey: "userId", as: "apiKeys" });
ApiKey.belongsTo(User, { foreignKey: "userId", as: "owner" });

ApiKey.hasMany(ApiKeyDailyUsage, { foreignKey: "apiKeyId", as: "dailyUsage" });
ApiKeyDailyUsage.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "apiKey" });
ApiKeyDailyUsage.belongsTo(User, { foreignKey: "userId", as: "owner" });

User.hasMany(Webhook, { foreignKey: "userId", as: "webhooks" });
Webhook.belongsTo(User, { foreignKey: "userId", as: "owner" });

User.hasMany(RequestData, { foreignKey: "userId", as: "requestData" });
RequestData.belongsTo(User, { foreignKey: "userId", as: "owner" });

ApiKey.hasMany(V3TaskResult, { foreignKey: "apiKeyId", as: "v3Results" });
V3TaskResult.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "apiKey" });

const { ensureDefaultAdmin } = require("../bootstrap/ensureAdmin");
const { ensureV3TaskResultSchema } = require("../bootstrap/ensureV3TaskResultSchema");

sequelize.sync({ force: false }).then(async () => {
  console.log('Database đã được đồng bộ!');
  try {
    await ensureV3TaskResultSchema();
    await ensureDefaultAdmin();
  } catch (err) {
    console.error("[bootstrap] Lỗi khởi tạo schema/admin:", err.message);
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
  RequestData,
  V3TaskResult,
};
