const URL_WEBHOOK =
    process.env.URL_WEBHOOK;

async function sendCallback(taskId, data = {}) {
    if (URL_WEBHOOK && URL_WEBHOOK.length > 10) {
        try {
            const response = await fetch(URL_WEBHOOK, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    "x-api-key": "abc",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    taskId,
                    data,
                }),
            });

            if (!response.ok) {
                console.error(
                    `Webhook failed: ${response.status} ${response.statusText}`
                );
                return false;
            }

            return true;
        } catch (error) {
            console.error("Webhook error:", error.message);
            return false;
        }
    }
}

module.exports = {
    sendCallback
}