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

const { authRoutes, userRoutes, setupRoutes, veoRoutes, adminRoutes } = require("./app/routes");

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
app.use("/api/setup", setupRoutes);
app.use("/api/admin", adminRoutes);

const PORT = 2053;
server.listen(PORT, () => console.log(`Listen: ${PORT}`));
