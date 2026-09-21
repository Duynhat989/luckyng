const { resolveApiKeyRecord } = require("../services/apiKeyRuntime.service");

function extractV3ApiKey(req) {
  const headerKey = req.headers["x-api-key"];
  if (headerKey) return String(headerKey).trim();

  const auth = req.headers.authorization || "";
  if (/^ApiKey\s+/i.test(auth)) {
    return auth.replace(/^ApiKey\s+/i, "").trim();
  }
  if (/^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token.startsWith("lnk_")) return token;
  }
  return "";
}

const authV3ApiKey = (roles = []) => {
  return async (req, res, next) => {
    if (typeof roles === "number") roles = [roles];

    const raw = extractV3ApiKey(req);
    if (!raw) {
      return res.status(401).json({ success: false, message: "API key required" });
    }

    try {
      const record = await resolveApiKeyRecord(raw);
      if (!record) {
        return res.status(401).json({ success: false, message: "Invalid API key" });
      }
      if (record.userStatus !== 1) {
        return res.status(403).json({ success: false, message: "User account disabled" });
      }
      if (roles.length && !roles.includes(record.role)) {
        return res.status(403).json({ success: false, message: "Not forbidden" });
      }

      // Không consume quota ở v3 — ghi nhận khi gọi FLOW_FIX_BASE_URL (/api/fix).

      req.apiKey = record;
      req.user = {
        id: record.userId,
        role: record.role,
        token: raw,
      };
      next();
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };
};

module.exports = authV3ApiKey;
