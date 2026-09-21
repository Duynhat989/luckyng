const { sequelize } = require("../config/config");

const { ROLES, User } = require('../models/userModel');
const { STATUS, Setup } = require('../models/setupModel');
const { packs } = require("./packModel");
const { ApiKey } = require("./apiKeyModel");
const { ApiKeyDailyUsage } = require("./apiKeyUsageModel");

User.hasOne(packs, { foreignKey: "userId", as: "pack" });
packs.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(ApiKey, { foreignKey: "userId", as: "apiKeys" });
ApiKey.belongsTo(User, { foreignKey: "userId", as: "owner" });

ApiKey.hasMany(ApiKeyDailyUsage, { foreignKey: "apiKeyId", as: "dailyUsage" });
ApiKeyDailyUsage.belongsTo(ApiKey, { foreignKey: "apiKeyId", as: "apiKey" });
ApiKeyDailyUsage.belongsTo(User, { foreignKey: "userId", as: "owner" });

sequelize.sync({ force: false }).then(() => {
  console.log('Database đã được đồng bộ!');
});
module.exports = {
  User,
  ROLES,
  STATUS,
  Setup,
  packs,
  ApiKey,
  ApiKeyDailyUsage,
};
