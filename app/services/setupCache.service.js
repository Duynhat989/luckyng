const { Setup } = require("../models");
const { dbQueue } = require("../utils/dbQueue");

const TTL_MS = parseInt(process.env.SETUP_CACHE_TTL_MS, 10) || 30_000;
const cache = new Map();

async function getSetupValue(name) {
  const hit = cache.get(name);
  if (hit && Date.now() < hit.expires) return hit.value;

  const row = await dbQueue.add(() =>
    Setup.findOne({ where: { name } })
  );
  const value = row ? row.value : null;
  cache.set(name, { value, expires: Date.now() + TTL_MS });
  return value;
}

function invalidateSetup(name) {
  if (name) cache.delete(name);
  else cache.clear();
}

module.exports = { getSetupValue, invalidateSetup };
