const fetch = require("node-fetch");
const { resolveWebhookTargets } = require("../services/webhookRuntime.service");

async function postOneWebhook(target, taskId, data) {
  const headers = {
    accept: "application/json",
    "Content-Type": "application/json",
  };
  if (target.headerApiKey) {
    headers["x-api-key"] = target.headerApiKey;
  }

  const response = await fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskId, data }),
  });

  if (!response.ok) {
    console.error(
      `[webhook] ${target.url} failed: ${response.status} ${response.statusText}`
    );
    return false;
  }
  return true;
}

async function sendCallback(taskId, data = {}) {
  const targets = await resolveWebhookTargets();
  if (!targets.length) return;

  await Promise.allSettled(
    targets.map(async (target) => {
      try {
        await postOneWebhook(target, taskId, data);
      } catch (error) {
        console.error(`[webhook] ${target.url} error:`, error.message);
      }
    })
  );
}

module.exports = {
  sendCallback,
};
