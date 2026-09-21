const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/config");

const Webhook = sequelize.define(
  "Webhooks",
  {
    label: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    url: {
      type: DataTypes.STRING(2048),
      allowNull: false,
    },
    headerApiKey: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
  },
  {
    indexes: [{ fields: ["userId"] }, { fields: ["status"] }],
  }
);

module.exports = { Webhook };
