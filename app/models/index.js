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

async function ensureV3TaskResultApiKeyColumn() {
  try {
    const [cols] = await sequelize.query(`SHOW COLUMNS FROM v3TaskResults LIKE 'apiKeyId'`);
    if (!cols || cols.length === 0) {
      await sequelize.query(
        `ALTER TABLE v3TaskResults ADD COLUMN apiKeyId INT NULL AFTER taskId`
      );
      await sequelize.query(
        `ALTER TABLE v3TaskResults ADD INDEX v3TaskResults_apiKeyId_createdAt (apiKeyId, createdAt)`
      );
      console.log("[bootstrap] Added v3TaskResults.apiKeyId");
    }
  } catch (err) {
    // bảng chưa tồn tại — sync sẽ tạo
    if (!/doesn't exist|Unknown table/i.test(err.message || "")) {
      console.error("[bootstrap] ensure apiKeyId:", err.message);
    }
  }
}

sequelize.sync({ force: false }).then(async () => {
  console.log('Database đã được đồng bộ!');
  try {
    await ensureV3TaskResultApiKeyColumn();
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
  RequestData,
  V3TaskResult,
};
