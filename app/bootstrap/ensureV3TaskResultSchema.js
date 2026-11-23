const { sequelize } = require("../config/config");

let ensurePromise = null;

/**
 * Đảm bảo cột apiKeyId tồn tại trên v3TaskResults (sync force:false không tự ADD COLUMN).
 */
function ensureV3TaskResultSchema() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    try {
      const [cols] = await sequelize.query(
        `SHOW COLUMNS FROM \`v3TaskResults\` LIKE 'apiKeyId'`
      );
      if (cols && cols.length > 0) return true;

      try {
        await sequelize.query(
          `ALTER TABLE \`v3TaskResults\` ADD COLUMN \`apiKeyId\` INT NULL`
        );
      } catch (err) {
        if (!/Duplicate column/i.test(err.message || "")) throw err;
      }

      try {
        await sequelize.query(
          `ALTER TABLE \`v3TaskResults\` ADD INDEX \`v3TaskResults_apiKeyId_createdAt\` (\`apiKeyId\`, \`createdAt\`)`
        );
      } catch (err) {
        if (!/Duplicate|exists/i.test(err.message || "")) {
          console.warn("[bootstrap] apiKeyId index:", err.message);
        }
      }

      console.log("[bootstrap] Added v3TaskResults.apiKeyId");
      return true;
    } catch (err) {
      ensurePromise = null;
      console.error("[bootstrap] ensureV3TaskResultSchema:", err.message);
      throw err;
    }
  })();

  return ensurePromise;
}

module.exports = { ensureV3TaskResultSchema };
