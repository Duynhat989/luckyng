const express = require("express");
const path = require("path");
const http = require("http");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();
const { connectDB } = require("./app/config/config");
connectDB();

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "stores")));

app.set('trust proxy', 1);

const storagePath = path.join(__dirname, 'storages');
app.use("/storages", express.static(storagePath));

app.use("/storages", (req, res) => {
    res.status(404).send("File not found in storages.");
});

app.use(cors({
    origin: '*',
    exposedHeaders: ['X-Encrypted', 'x-encrypted']
}))
app.use(bodyParser.json({ limit: "500mb" }));
app.use(bodyParser.urlencoded({ limit: "500mb", extended: true }));

const decryptMiddleware = require('./app/middlewares/decryptMiddleware.js')
const encryptResponseMiddleware = require('./app/middlewares/encryptResponseMiddleware.js')
app.use(decryptMiddleware);
app.use(encryptResponseMiddleware);

const { authRoutes, userRoutes, setupRoutes, veoRoutes, adminRoutes, v3FlowRoutes } = require("./app/routes");

const statusReport = {
    success: 0,
    error: 0,
    apiStats: {}
};
app.use((req, res, next) => {
    if (req.originalUrl.includes('.json')
        || req.originalUrl.includes('.php')
        || req.originalUrl.includes('.env')
        || req.originalUrl.includes('.txt')
        || req.originalUrl.includes('.xml')
        || req.originalUrl.includes('/json')
    ) {
        return res.status(403).send('Forbidden: Access denied. Go bother someone else.')
    }
    next();
});

app.use((req, res, next) => {
    const originalStatus = res.status;
    const originalSend = res.send;

    res._customStatusCode = 200;
    res._responseBody = null;

    res.status = function (code) {
        res._customStatusCode = code;
        return originalStatus.call(this, code);
    };

    res.send = function (body) {
        res._responseBody = body;
        return originalSend.call(this, body);
    };

    res.on('finish', () => {
        const statusCode = res._customStatusCode || res.statusCode;
        const url = req.originalUrl;

        if (!statusReport.apiStats[url] && !url.includes('get_task')) {
            statusReport.apiStats[url] = { total: 0, success: 0, error: 0 };
        }
        if (!url.includes('get_task')) {
            statusReport.apiStats[url].total += 1;
        }

        if (statusCode === 200 && !url.includes('get_task')) {
            statusReport.success += 1;
            statusReport.apiStats[url].success += 1;
        } else {
            if (!url.includes('get_task')) {
                let bodyStr = '';
                try { bodyStr = JSON.stringify(res._responseBody); } catch (e) { }

                if (!bodyStr.includes('Too many requests. Please')
                    && !bodyStr.includes('Your account has been locked from this feature.')
                    && !bodyStr.includes('Insufficient balance')
                    && !bodyStr.includes('Task not found')
                    && !bodyStr.includes('Blocked')
                    && !bodyStr.includes('Browser ID bị từ chối')
                    && !bodyStr.includes('Not login')
                    && !bodyStr.includes('taskId is required')
                ) {
                    statusReport.error += 1;
                    statusReport.apiStats[url].error += 1;

                    console.log(`❌ [${req.method}] ${url} -> Status: ${statusCode}`);
                    console.log("🧨 Response Error Body:", bodyStr);
                }
            }
        }
    });

    next();
});

app.use("/api/auth", authRoutes);
app.use("/api", userRoutes);
app.use("/api/fix", veoRoutes);
app.use("/api/v3", v3FlowRoutes);
app.use("/api/setup", setupRoutes);
app.use("/api/admin", adminRoutes);

const { flushUsageNow, warmKeyCache } = require("./app/services/apiKeyRuntime.service");

async function shutdown() {
    try {
        await flushUsageNow();
    } catch (e) {
        console.error("Flush usage on shutdown:", e.message);
    }
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const PORT = 2053;
server.listen(PORT, () => {
    console.log(`Listen: ${PORT}`);
    warmKeyCache();
    sendTelegramMessage("CPU: Start service");
});

const { execFile } = require("child_process");
const { rqHope } = require("./app/controllers/veoController.js");

const CPU_POLL_MS = 15_000;
const CPU_HIGH_PERCENT = 90;
const CPU_HIGH_LIMIT_MS = 1.5 * 60 * 1000;

let cpuSample = process.cpuUsage();
let cpuSampleAt = Date.now();
let cpuHighSince = null;
let cpuRestartScheduled = false;


const telegramBotToken = "8634802465:AAHyyVIK9a-u0K5aHDre2JvR9ufWNL6HPwo";
const telegramChatId = "-5348353930";

const sendTelegramMessage = async (message) => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: message
            })
        });
        if (response.ok) {
            console.log("Telegram message sent successfully");
            return;
        }
        const body = await response.text();
        console.error("Failed to send Telegram message", response.status, body);
    } catch (error) {
        console.error("Error sending Telegram message:", error);
    }
}

async function pollCpuAndRestartIfStuck() {
    const now = Date.now();
    const elapsedMs = now - cpuSampleAt;
    const usage = process.cpuUsage(cpuSample);
    cpuSample = process.cpuUsage();
    cpuSampleAt = now;

    if (elapsedMs < 1000) return;

    const cpuPercent = ((usage.user + usage.system) / 1000 / elapsedMs) * 100;

    if (cpuPercent <= CPU_HIGH_PERCENT) {
        console.log(`[cpu] ${cpuPercent.toFixed(1)}% <= ${CPU_HIGH_PERCENT}%, reset timer`);
        if (cpuHighSince) {
            console.error(`[cpu] ${cpuPercent.toFixed(1)}%, reset timer`);
        }
        cpuHighSince = null;
        return;
    }

    if (!cpuHighSince) cpuHighSince = now;
    const highForMs = now - cpuHighSince;
    console.error(
        `[cpu] ${cpuPercent.toFixed(1)}% for ${Math.round(highForMs / 1000)}s`
    );

    if (highForMs < CPU_HIGH_LIMIT_MS || cpuRestartScheduled) return;

    cpuRestartScheduled = true;
    const requestHope = await rqHope();
    await Promise.race([
        sendTelegramMessage(`[CPU High Alert] CPU: ${cpuPercent.toFixed(1)}% for ${Math.round(CPU_HIGH_LIMIT_MS / 1000 / 60)} minutes, ${JSON.stringify(requestHope)}`),
        new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    setTimeout(() => {
        execFile("pm2", ["restart", "index"], (err, stdout, stderr) => {
            if (stdout) console.log(stdout.trim());
            if (err) {
                cpuRestartScheduled = false;
                cpuHighSince = Date.now();
                console.error("[cpu] pm2 restart failed:", err.message);
                if (stderr) console.error(stderr.trim());
            }
        });
    }, 2 * 1000);
}

setInterval(pollCpuAndRestartIfStuck, CPU_POLL_MS);
