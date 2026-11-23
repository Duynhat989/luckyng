const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/config");

/** status: success | failed | error */
const V3TaskResult = sequelize.define(
  "V3TaskResult",
  {
    taskId: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    apiKeyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "API key id gọi /api/v3",
    },
    result: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
      comment: "JSON kết quả task",
    },
    status: {
      type: DataTypes.ENUM("success", "failed", "error"),
      allowNull: false,
    },
  },
  {
    tableName: "v3TaskResults",
    indexes: [
      { fields: ["taskId"] },
      { fields: ["apiKeyId", "createdAt"] },
      { fields: ["status", "createdAt"] },
      { fields: ["createdAt"] },
    ],
  }
);

module.exports = { V3TaskResult };
