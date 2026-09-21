const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/config");

const ApiKey = sequelize.define(
  "ApiKeys",
  {
    label: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    keyValue: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    dailyLimit: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1000,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
  },
  {
    indexes: [{ fields: ["userId"] }, { fields: ["keyValue"] }],
  }
);

module.exports = { ApiKey };
