const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/config");

const ApiKeyDailyUsage = sequelize.define(
  "ApiKeyDailyUsage",
  {
    apiKeyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    statDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    requestCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    indexes: [
      { unique: true, fields: ["apiKeyId", "statDate"] },
      { fields: ["userId", "statDate"] },
    ],
  }
);

module.exports = { ApiKeyDailyUsage };
