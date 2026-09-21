require('dotenv').config();
const { Sequelize } = require('sequelize');

// Khởi tạo kết nối Sequelize
const poolMax = parseInt(process.env.DB_POOL_MAX, 10) || 20;

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
    pool: {
        max: poolMax,
        min: 0,
        acquire: 30000,
        idle: 10000,
    },
    dialectOptions: {
        charset: 'utf8mb4',
    },
    define: {
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    }
});
// Hàm để kiểm tra kết nối với cơ sở dữ liệu
const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Successfully connected to MySQL database!');
    } catch (error) {
        console.error('Connection failed:', error.message);
        process.exit(1); 
    }
};

module.exports = { sequelize, connectDB };
