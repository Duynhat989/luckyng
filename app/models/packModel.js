const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/config");
// Định nghĩa model User
const packs = sequelize.define(
  "packs",
  {
    pack: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Free" // 3 options Free,Stand,Pro,VIP
    },
    renewal: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    expired: {
      type: DataTypes.INTEGER,
      allowNull: true //KHI MÀ RENEW THÌ 
    },
    lastBalanceUpdate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
  }
);
module.exports = { packs };