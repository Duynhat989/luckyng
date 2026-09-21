const { ApiKey } = require("../models/apiKeyModel");
const { ApiKeyDailyUsage } = require("../models/apiKeyUsageModel");
const { User } = require("../models/userModel");
const { getTodayInVietnam } = require("../utils/date");
const { dbQueue } = require("../utils/dbQueue");

const STATUS_ON = 1;
const KEY_CACHE_TTL_MS = parseInt(process.env.API_KEY_CACHE_TTL_MS, 10) || 60_000;
const USAGE_FLUSH_MS = parseInt(process.env.USAGE_FLUSH_MS, 10) || 2000;

/** @type {Map<string, { data: object, expires: number }>} */
const keyCache = new Map();

/** @type {Map<string, { base: number, pending: number, userId: number }>} */
const usageByKeyDay = new Map();

/** @type {Map<string, { userId: number, delta: number }>} */
const flushPending = new Map();

/** @type {Set<string>} */
const baselineScheduled = new Set();

let flushTimer = null;

function cacheKeyForToken(token) {
  return token;
}

function usageMapKey(apiKeyId, statDate) {
  return `${apiKeyId}:${statDate}`;
}

function getCachedKey(token) {
  const hit = keyCache.get(cacheKeyForToken(token));
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    keyCache.delete(cacheKeyForToken(token));
    return null;
  }
  return hit.data;
}

function setCachedKey(token, data) {
  keyCache.set(cacheKeyForToken(token), {
    data,
    expires: Date.now() + KEY_CACHE_TTL_MS,
  });
}

function invalidateAllKeyCache() {
  keyCache.clear();
}

function invalidateKeyCache(token) {
  if (token) keyCache.delete(cacheKeyForToken(token));
}

function mapRecord(record) {
  if (!record || !record.owner) return null;
  return {
    id: record.id,
    userId: record.userId,
    dailyLimit: record.dailyLimit,
    keyValue: record.keyValue,
    role: record.owner.role,
    userStatus: record.owner.status,
  };
}

function loadKeyFromDbQueued(token) {
  return dbQueue.add(async () => {
    const record = await ApiKey.findOne({
      where: { keyValue: token, status: STATUS_ON },
      include: [{ model: User, as: "owner", attributes: ["id", "role", "status"] }],
    });
    return mapRecord(record);
  });
}

/** Chỉ await DB khi cache miss — sau warm-up hầu hết request không đụng DB. */
async function resolveApiKeyRecord(token) {
  const cached = getCachedKey(token);
  if (cached) return cached;

  const data = await loadKeyFromDbQueued(token);
  if (data) setCachedKey(token, data);
  return data;
}

function scheduleBaselineLoad(apiKeyId, statDate, userId) {
  const k = usageMapKey(apiKeyId, statDate);
  if (baselineScheduled.has(k)) return;
  baselineScheduled.add(k);

  dbQueue
    .add(async () => {
      const row = await ApiKeyDailyUsage.findOne({
        where: { apiKeyId, statDate },
      });
      const state = usageByKeyDay.get(k);
      if (!state) return;
      const dbCount = row ? row.requestCount : 0;
      if (dbCount > state.base) {
        state.base = dbCount;
      }
    })
    .catch((err) => {
      console.error("[apiKeyRuntime] baseline load error:", err.message);
    });
}

/** Khởi tạo state trong RAM — không await DB. */
function getOrCreateUsageState(apiKeyId, statDate, userId) {
  const k = usageMapKey(apiKeyId, statDate);
  let state = usageByKeyDay.get(k);
  if (!state) {
    state = { base: 0, pending: 0, userId };
    usageByKeyDay.set(k, state);
    scheduleBaselineLoad(apiKeyId, statDate, userId);
  }
  return state;
}

function getLiveUsageCount(apiKeyId, statDate) {
  const state = usageByKeyDay.get(usageMapKey(apiKeyId, statDate));
  if (!state) return null;
  return state.base + state.pending;
}

function queueUsageFlush(apiKeyId, statDate, userId) {
  const k = usageMapKey(apiKeyId, statDate);
  const cur = flushPending.get(k) || { userId, delta: 0 };
  cur.delta += 1;
  cur.userId = userId;
  flushPending.set(k, cur);
}

function flushUsageToDb() {
  if (flushPending.size === 0) return Promise.resolve();

  const batch = new Map(flushPending);
  flushPending.clear();

  return dbQueue
    .add(async () => {
      for (const [k, { userId, delta }] of batch) {
        if (delta <= 0) continue;
        const sep = k.indexOf(":");
        const apiKeyId = k.slice(0, sep);
        const statDate = k.slice(sep + 1);
        const [row] = await ApiKeyDailyUsage.findOrCreate({
          where: { apiKeyId, statDate },
          defaults: { userId, requestCount: 0 },
        });
        await row.increment("requestCount", { by: delta });

        const mem = usageByKeyDay.get(k);
        if (mem) {
          mem.base += delta;
          mem.pending = Math.max(0, mem.pending - delta);
        }
      }
    })
    .catch((err) => {
      for (const [k, v] of batch) {
        const cur = flushPending.get(k) || { userId: v.userId, delta: 0 };
        cur.delta += v.delta;
        flushPending.set(k, cur);
      }
      throw err;
    });
}

function startUsageFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushUsageToDb().catch((err) => {
      console.error("[apiKeyRuntime] flush usage error:", err.message);
    });
  }, USAGE_FLUSH_MS);
}

/**
 * Đồng bộ — chỉ RAM. Ghi DB xếp hàng qua flushPending, không chặn request.
 */
function consumeDailyQuota(apiKeyId, userId, dailyLimit) {
  const statDate = getTodayInVietnam();
  const state = getOrCreateUsageState(apiKeyId, statDate, userId);
  const total = state.base + state.pending;

  if (total >= dailyLimit) {
    return {
      ok: false,
      statDate,
      dailyLimit,
      used: total,
    };
  }

  state.pending += 1;
  queueUsageFlush(apiKeyId, statDate, userId);

  return {
    ok: true,
    statDate,
    dailyLimit,
    used: total + 1,
  };
}

function flushUsageNow() {
  return flushUsageToDb();
}

function scheduleFlushUsageNow() {
  flushUsageToDb().catch((err) => {
    console.error("[apiKeyRuntime] flush usage error:", err.message);
  });
}

function warmKeyCache() {
  dbQueue
    .add(async () => {
      const keys = await ApiKey.findAll({
        where: { status: STATUS_ON },
        include: [{ model: User, as: "owner", attributes: ["id", "role", "status"] }],
      });
      for (const record of keys) {
        const data = mapRecord(record);
        if (data) setCachedKey(data.keyValue, data);
      }
      console.log(`[apiKeyRuntime] warmed ${keys.length} API key(s) in cache`);
    })
    .catch((err) => {
      console.error("[apiKeyRuntime] warm cache error:", err.message);
    });
}

function getRuntimeStats() {
  return {
    keyCacheSize: keyCache.size,
    usageStates: usageByKeyDay.size,
    flushPending: flushPending.size,
    dbQueue: dbQueue.getStats(),
  };
}

startUsageFlushLoop();

module.exports = {
  resolveApiKeyRecord,
  consumeDailyQuota,
  invalidateAllKeyCache,
  invalidateKeyCache,
  flushUsageNow,
  scheduleFlushUsageNow,
  warmKeyCache,
  getRuntimeStats,
  getLiveUsageCount,
};
