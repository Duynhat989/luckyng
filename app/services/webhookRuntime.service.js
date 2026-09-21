const { Webhook } = require("../models/webhookModel");
const { dbQueue } = require("../utils/dbQueue");

const STATUS_ON = 1;
const CACHE_TTL_MS =
  parseInt(process.env.WEBHOOK_CACHE_TTL_MS, 10) || 60_000;

/** @type {{ list: Array<{ url: string, headerApiKey: string | null }>, expires: number } | null} */
let cache = null;

function mapRow(row) {
  return {
    url: row.url,
    headerApiKey: row.headerApiKey || null,
  };
}

function invalidateWebhookCache() {
  cache = null;
}

async function loadActiveFromDb() {
  const rows = await dbQueue.add(() =>
    Webhook.findAll({
      where: { status: STATUS_ON },
      attributes: ["url", "headerApiKey"],
      order: [["id", "ASC"]],
    })
  );
  return rows.map(mapRow);
}

async function getActiveWebhooks() {
  if (cache && Date.now() < cache.expires) {
    return cache.list;
  }
  const list = await loadActiveFromDb();
  cache = { list, expires: Date.now() + CACHE_TTL_MS };
  return list;
}

async function resolveWebhookTargets() {
  return getActiveWebhooks();
}

module.exports = {
  invalidateWebhookCache,
  getActiveWebhooks,
  resolveWebhookTargets,
};
