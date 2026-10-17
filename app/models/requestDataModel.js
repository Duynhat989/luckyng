const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/config");

const RequestData = sequelize.define(
  "RequestData",
  {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    taskId: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    attempt: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Lần thử thứ mấy thì pass",
    },
    flowUrl: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    requestType: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "video | image",
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    secChUa: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "requestData",
    indexes: [
      { fields: ["userId", "createdAt"] },
      { fields: ["taskId"] },
      { fields: ["attempt"] },
      { fields: ["requestType", "createdAt"] },
    ],
  }
);

module.exports = { RequestData };
