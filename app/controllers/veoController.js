const { User, RequestData, Setup, Payment } = require("../models");
const { sequelize } = require("../config/config.js");
const { veo3Video } = require("../modules/veo3.module.js");
const { v4: uuidv4 } = require("uuid"); // Import UUID
const { saveRequestData } = require("../modules/bulkCreate.module.js");
const { hasPackageOrBalance, consumePackageOrBalance, refundPackageOrBalance } = require("../modules/packageQuota.module.js");
const { Op, fn, col } = require("sequelize");
const { tokenVideoManager, tokenImageManager } = require("../modules/tokenCaptchaShared.module");
const { execFile } = require("child_process");
const rejectBrowserIds = new Set();
const addTokenCaptcha = async (req, res) => {
    try {
        const { tokenCaptcha, browserId, type = "video", fingerprint = {} } = req.body;

        if (browserId) {
            // if (rejectBrowserIds.has(browserId)) {
            //     return res.status(403).json({
            //         success: false,
            //         message: 'Browser ID bị từ chối'
            //     });
            // }
        }
        if (!tokenCaptcha) {
            return res.status(400).json({
                success: false,
                message: 'Token captcha là bắt buộc'
            });
        }
        const isValid = tokenCaptcha?.startsWith("HF");
        if (isValid) {
            return res.status(400).json({
                success: false,
                message: `Token sai định dạng [veo] ${tokenCaptcha.slice(0, 10)}`
            });
        }

        const newTokenCaptcha = `${tokenCaptcha}|${fingerprint?.userAgent || ""} | ${fingerprint?.secChUa || ""}`
        if (type === "video") {
            const added = tokenVideoManager.addToken(newTokenCaptcha);
            if (!added) {
                return res.status(409).json({
                    success: false,
                    message: 'Token đã tồn tại trong hệ thống'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Thêm token thành công',
                type: "video",
                validTokenCount: tokenVideoManager.getValidTokenCount()
            });

        } else {
            const added = tokenImageManager.addToken(newTokenCaptcha);
            if (!added) {
                return res.status(409).json({
                    success: false,
                    message: 'Token đã tồn tại trong hệ thống'
                });
            }
            return res.status(200).json({
                success: true,
                message: 'Thêm token thành công',
                type: "image",
                validTokenCount: tokenImageManager.getValidTokenCount()
            });
        }
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Lỗi server',
            error: error.message
        });
    }
};
let numberQuer = 0
let requireGenvideo = 0;
let requireImage = 0;

const waitForTokenCaptcha = async (isGenvideo = true) => {
    numberQuer++;
    if (isGenvideo) {
        requireGenvideo++;
    } else {
        requireImage++;
    }
    return new Promise((resolve) => {
        let done = false;
        let checkInterval;
        let timeoutId;
        const finish = (result) => {
            if (done) return;
            done = true;
            if (isGenvideo) requireGenvideo--;
            else requireImage--;
            numberQuer--;
            if (checkInterval) clearInterval(checkInterval);
            if (timeoutId) clearTimeout(timeoutId);
            resolve(result);
        };
        if (true) {
            // const runAds = async () => {
            //     try {
            //         const tokenNew = await getGeminiToken()
            //         if (tokenNew) {
            //             console.log("Add token")
            //             tokenVideoManager.addToken(tokenNew);
            //         }
            //     } catch (error) {  }
            // }
            // runAds()
        }
        if (isGenvideo) {
            checkInterval = setInterval(() => {
                const token = tokenVideoManager.getToken();
                if (token) {
                    finish(token);
                }
            }, 200);
            timeoutId = setTimeout(() => {
                finish(null);
            }, 120 * 1000);
        }
        else {
            checkInterval = setInterval(() => {
                const token = tokenImageManager.getToken();
                if (token) {
                    finish(token);
                }
            }, 200);
            timeoutId = setTimeout(() => {
                finish(null);
            }, 120 * 1000);
        }
    });
};

const countBlock = {}
const block = new Set()
const payToken = async (req, res) => {
    const userId = req.user.id;
    const requireType = req.query.type || "video";
    const COST = 30;
    let deducted = false;
    if (block.has(userId)) {
        return res.status(403).json({ success: false, message: "Blocked" })
    }
    try {
        await sequelize.transaction(async (t) => {
            const user = await User.findByPk(userId, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (!user) throw { code: 404, message: "Not found user" };
            if (user.balance < COST) {
                countBlock[userId] = (countBlock[userId] || 0) + 1;
                if (countBlock[userId] > 15) {
                    if (!block.has(userId)) {
                        console.log("User blocked: ", userId)
                        block.add(userId)
                        await User.update(
                            { status: 2 },
                            { where: { id: userId } }
                        );
                    }
                }
                throw { code: 402, message: "Insufficient balance" };
            }

            await user.decrement("balance", {
                by: COST,
                transaction: t
            });

            countBlock[userId] = 0;
            deducted = true;
        });

        // 2️⃣ Lấy captcha token
        const dataNewToken = await waitForTokenCaptcha(requireType === "video");
        const [token = "", userAgent = "", secChUa = ""] = (dataNewToken?.token || "").split("|");
        if (!token) {
            throw { code: 408, message: "Captcha token timeout" };
        }
        const countTokens = tokenVideoManager.getValidTokenCount();
        console.log(`${userId} => Provided captcha token: `, countTokens);
        // 3️⃣ Thành công
        const createTimeTask = Date.now();
        saveRequestData({
            userId,
            createTimeTask,
            content: JSON.stringify({
                cost: COST,
                type: "token",
                msg: "Get token success"
            })
        })

        return res.status(200).json({
            success: true,
            token: token,
            age: dataNewToken?.age,
            userAgent: userAgent,
            secChUa: secChUa,
            countTokens: countTokens
        });

    } catch (error) {
        // 4️⃣ Hoàn tiền nếu đã trừ
        if (deducted) {
            try {
                await User.increment("balance", {
                    by: COST,
                    where: { id: userId }
                });
            } catch (refundErr) {
                console.error("REFUND FAILED:", refundErr);
            }
        }

        return res.status(error.code || 500).json({
            success: false,
            message: error.message || "Internal server error"
        });
    }
};
const getBalance = async (req, res) => {
    const userId = req.user.id;
    try {
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        return res.status(200).json({
            success: true,
            balance: user.balance,
            email: user.email
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};
const getTokenAval = async (req, res) => {
    try {
        const countTokens = tokenVideoManager.getValidTokenCount();
        return res.status(200).json({
            success: true,
            countTokens: countTokens
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
}


const getBlockUser = async (req, res) => {
    return res.json({
        count: block.size,
        users: Array.from(block)
    });
};

const unBlockUser = async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    block.delete(userId)

    return res.json({
        success: true,
        blocked: Array.from(block)
    });
};

const MAX_VEO_TASK = 200;
const RETRY = 150;

/* ===================== QUEUE CORE ===================== */

let runningVeoTasks = 0;
const veoQueue = [];
const statusTasks = new Map();

const VEO_QUEUE_RESTART_LIMIT = 100;
let pm2RestartScheduled = false;

function restartIndexIfQueueOverflow() {
    if (veoQueue.length <= VEO_QUEUE_RESTART_LIMIT) return;
    if (pm2RestartScheduled) return;

    pm2RestartScheduled = true;
    console.error(
        `[veoQueue] length ${veoQueue.length} > ${VEO_QUEUE_RESTART_LIMIT}, pm2 restart index`
    );

    execFile("pm2", ["restart", "index"], (err, stdout, stderr) => {
        if (stdout) console.log(stdout.trim());
        if (err) {
            pm2RestartScheduled = false;
            console.error("[veoQueue] pm2 restart failed:", err.message);
            if (stderr) console.error(stderr.trim());
        }
    });
}

const runVeoQueue = () => {
    if (runningVeoTasks >= MAX_VEO_TASK) return;
    if (veoQueue.length === 0) return;

    const task = veoQueue.shift();
    runningVeoTasks++;

    task()
        .catch(err => {
            console.error("VEO TASK ERROR:", err);
        })
        .finally(async () => {
            await new Promise(r => setTimeout(r, 5000));
            runningVeoTasks--;
            runVeoQueue();
        });
};

/* ===================== MAIN HANDLER ===================== */
let countTasks = 0;


const logsData = {
    success: 0,
    error: 0
}

const createVideoVeo3 = async (req, res) => {
    const userId = req.user.id;
    let COST = 40;
    let paymentInfo = null;
    let balanceOld = 0;
    if (block.has(userId)) {
        return res.status(403).json({ success: false, message: "Blocked" })
    }
    const createTimeTask = Date.now();
    try {
        const { flow_auth_token, body_json, flow_url, is_proxy = false, proxy = "" } = req.body;

        if (!body_json) return res.status(400).json({ success: false, message: "body_json is required" });
        if (!flow_auth_token) return res.status(400).json({ success: false, message: "flow_auth_token is required" });
        if (!flow_url) return res.status(400).json({ success: false, message: "flow_url is required" });

        const taskId = req.enterprise?.taskId || uuidv4();

        if (req.enterprise) {
            req.enterprise.hold = true;
            paymentInfo = {
                type: "enterprise",
                remaining: req.enterprise.dailyRemaining,
                balance: null,
            };
            balanceOld = null;
            saveRequestData({
                userId,
                createTimeTask,
                taskId,
                content: JSON.stringify({
                    taskId,
                    cost: "enterprise",
                    type: "create-veo",
                    msg: "Charge success",
                    paymentType: "enterprise",
                    endpointKey: req.enterprise.endpointKey,
                    dailyUsed: req.enterprise.dailyUsed,
                    dailyQuota: req.enterprise.dailyQuota,
                    packageRemaining: req.enterprise.dailyRemaining,
                }),
            });
        } else await sequelize.transaction(async (t) => {
            const check = await hasPackageOrBalance(userId, "createVideoVeo3", COST, t);
            if (!check.ok) {
                countBlock[userId] = (countBlock[userId] || 0) + 1;

                if (countBlock[userId] > 15) {
                    if (!block.has(userId)) {
                        console.log("User blocked: ", userId)
                        block.add(userId)
                        await User.update(
                            { status: 2 },
                            { where: { id: userId } }
                        );
                    }
                }
                throw { code: 402, message: "Insufficient balance" };
            }

            paymentInfo = await consumePackageOrBalance(userId, "createVideoVeo3", COST, t);
            balanceOld = paymentInfo.balance;
            countBlock[userId] = 0;

            console.log(
                `[createVideoVeo3] user=${userId} | ${paymentInfo.type === "package" ? "CREDITS" : "TIỀN"} | cost=${paymentInfo.type === "package" ? "1 lượt" : COST} | remaining=${paymentInfo.remaining ?? "N/A"} | balance=${balanceOld}`
            );

            saveRequestData({
                userId,
                createTimeTask,
                taskId,
                content: JSON.stringify({
                    taskId,
                    cost: paymentInfo.type === "package" ? "package" : COST,
                    type: "create-veo",
                    msg: "Charge success",
                    paymentType: paymentInfo.type,
                    balance: balanceOld,
                    ...(paymentInfo.type === "package"
                        ? {
                            userPackageId: paymentInfo.userPackageId,
                            planName: paymentInfo.planName,
                            service: paymentInfo.service,
                            usedQuota: paymentInfo.usedQuota,
                            totalQuota: paymentInfo.totalQuota,
                            packageRemaining: paymentInfo.remaining,
                        }
                        : {
                            packageRemaining: null,
                        }),
                }),
            });
        });
        countTasks++;

        const startTime = Date.now();
        /* ====== INIT TASK ====== */

        statusTasks.set(taskId, {
            success: false,
            code: "queued",
            message: "Task is waiting in queue"
        });

        /* ====== CREATE QUEUE TASK ====== */
        const paymentSnapshot = paymentInfo ? { ...paymentInfo } : null;
        const createTask = async () => {
            try {
                if (req.enterprise?.waitSlot) await req.enterprise.waitSlot();
                statusTasks.set(taskId, {
                    success: false,
                    code: "processing",
                    message: "Task is being processed"
                });

                for (let attempt = 1; attempt <= RETRY; attempt++) {
                    const isImage = flow_url.includes("batchGenerateImages") || flow_url.includes("upsampleImage");
                    const dataNewToken = await waitForTokenCaptcha(!isImage);
                    const [token = "", userAgent = "", secChUa = ""] = (dataNewToken?.token || "").split("|");
                    if (!token) continue;
                    if (body_json?.clientContext?.recaptchaContext) {
                        try {
                            body_json.clientContext.recaptchaContext.token = token
                        } catch (error) {
                            console.error("Error setting recaptchaContext token:", error);
                        }
                    } else {
                        if (body_json?.agentClientContext?.recaptchaContext)
                        {
                            try { body_json.agentClientContext.recaptchaContext.token = token; } catch { }
                        }else{
                            try { body_json.clientContext = { recaptchaToken: token }; } catch { }
                        }
                    }
                    if (flow_url.includes("batchGenerateImages")) {
                        for (let i = 0; i < body_json.requests.length; i++) {
                            if (body_json.requests[i]?.clientContext?.recaptchaContext) {
                                try { body_json.requests[i].clientContext.recaptchaContext.token = token; } catch (error) {
                                    console.error("Error setting recaptchaContext token for image:", error);
                                }
                            } else {
                                try { body_json.requests[i].clientContext.recaptchaToken = token; } catch { }
                            }
                        }
                    }

                    const veo3 = new veo3Video(flow_auth_token, is_proxy, proxy, userAgent, secChUa)
                    const result = await veo3.generateVideo(body_json, flow_url);
                    if (JSON.stringify(result).includes("reCAPTCHA evaluation failed")) {
                        statusTasks.set(taskId, {
                            success: false,
                            code: "processing",
                            message: `Task is being step ${attempt}`
                        });
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    /* ====== SUCCESS ====== */
                    statusTasks.set(taskId, {
                        success: true,
                        message: "successfully",
                        result
                    });

                    const processingTime = Date.now() - startTime;
                    if (req.enterprise?.onDone) req.enterprise.onDone();
                    saveRequestData({
                        userId,
                        createTimeTask,
                        taskId,
                        content: JSON.stringify({
                            taskId,
                            cost: paymentSnapshot?.type === "package" ? "package" : paymentSnapshot?.type === "enterprise" ? "enterprise" : COST,
                            type: "create-veo",
                            msg: "Create video success",
                            step: attempt,
                            balance: balanceOld,
                            paymentType: paymentSnapshot?.type,
                            packageRemaining: paymentSnapshot?.remaining,
                            time: processingTime
                        })
                    });
                    logsData.success += 1
                    return;
                }
                /* ====== FAIL ALL ====== */
                statusTasks.set(taskId, {
                    success: false,
                    code: "failed",
                    message: "All attempts failed",
                    isRefund: true
                });

                if (paymentSnapshot) {
                    const processingTime = Date.now() - startTime;
                    saveRequestData({
                        userId,
                        createTimeTask,
                        taskId,
                        content: JSON.stringify({
                            taskId,
                            cost: paymentSnapshot.type === "package" ? "package-refund" : paymentSnapshot.type === "enterprise" ? "enterprise-refund" : `+${COST}`,
                            type: "create-veo",
                            msg: "Refund after fail",
                            paymentType: paymentSnapshot.type,
                            time: processingTime
                        })
                    });
                    if (paymentSnapshot.type === "enterprise") {
                        if (req.enterprise?.onRefund) await req.enterprise.onRefund();
                        if (req.enterprise?.onDone) req.enterprise.onDone();
                    } else {
                        await refundPackageOrBalance(userId, paymentSnapshot, COST);
                    }
                }

                logsData.error += 1
            } catch (err) {
                logsData.error += 1
                statusTasks.set(taskId, {
                    success: false,
                    code: "error",
                    message: err.message
                });
                if (paymentSnapshot?.type === "enterprise") {
                    if (req.enterprise?.onRefund) await req.enterprise.onRefund();
                    if (req.enterprise?.onDone) req.enterprise.onDone();
                }
                throw err;
            }
        };
        veoQueue.push(createTask);
        restartIndexIfQueueOverflow();
        runVeoQueue();

        return res.status(200).json({
            success: true,
            taskId,
            paymentType: paymentInfo?.type,
            packageRemaining: paymentInfo?.remaining ?? null,
            balance: paymentInfo?.balance,
        });

    } catch (err) {
        if (paymentInfo) {
            if (paymentInfo.type === "enterprise") {
                if (req.enterprise?.onRefund) await req.enterprise.onRefund();
                if (req.enterprise?.onDone) req.enterprise.onDone();
            } else {
                await refundPackageOrBalance(userId, paymentInfo, COST);
            }
            saveRequestData({
                userId,
                createTimeTask,
                taskId,
                content: JSON.stringify({
                    taskId,
                    cost: paymentInfo.type === "package" ? "package-refund" : paymentInfo.type === "enterprise" ? "enterprise-refund" : `+${COST}`,
                    type: "create-veo",
                    msg: "Refund after fail",
                    paymentType: paymentInfo.type,
                    error: "catch error"
                })
            });
        }

        return res.status(err.code || 500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};

const clearData = (taskId) => {
    const task = statusTasks.get(taskId);
    if (!task) return;

    // đã lên lịch xoá rồi thì bỏ qua
    if (task.__clearing) return;

    task.__clearing = true;

    setTimeout(() => {
        statusTasks.delete(taskId);
    }, 30 * 60 * 1000); //thời gian chờ 
};

const getTaskStatus = async (req, res) => {
    try {
        const { taskId } = req.query;
        if (!taskId) {
            return res.status(400).json({
                success: false,
                message: 'taskId is required'
            });
        }
        const status = statusTasks.get(taskId);
        if (!status) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }
        if (status && status?.code !== "processing") {
            clearData(taskId)
        }
        return res.status(200).json(status);
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
}

const checkTokenByPass = async (req, res) => {
    try {
        const { browserId, token } = req.body;
        if (browserId) {
            const body_json = {
                "clientContext": {
                    "recaptchaContext": {
                        "token": token,
                        "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                    },
                    "sessionId": ";1771422879677",
                    "projectId": "c38ca641-c21d-4b63-acc5-1d6a9ccb5e02",
                    "tool": "PINHOLE",
                    "userPaygateTier": "PAYGATE_TIER_NOT_PAID"
                },
                "requests": [{
                    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
                    "seed": 20587,
                    "textInput": {
                        "prompt": "ăn gì anh mời"
                    },
                    "videoModelKey": "veo_3_1_t2v_fast",
                    "metadata": {
                        "sceneId": "ebf836e3-455f-4acf-b721-5360d1020a79"
                    }
                }]
            }
            const flow_url = "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
            const setups = await Setup.findOne({
                where: {
                    name: 'API_KEY'
                }
            });

            if (!setups) {
                return res.status(403).json({
                    success: true,
                    code: "captcha",
                    message: 'Captcha Veo hết hạn'
                });
            }
            var veo3 = new veo3Video(setups.value, false);
            const result = await veo3.generateVideo(body_json, flow_url);
            if (JSON.stringify(result).includes("reCAPTCHA")) {
                console.log("reCAPTCHA evaluation failed")
                rejectBrowserIds.add(browserId);
                return res.status(403).json({
                    success: false,
                    code: "captcha",
                    message: 'Browser ID bị từ chối'
                });
            }
            console.log(result)
            return res.status(200).json({
                success: true,
                code: "bypass",
                message: 'Browser ID'
            });
        }
        return res.status(400).json({
            success: false,
            message: 'browserId là bắt buộc'
        });
    } catch (error) {

        return res.status(500).json({
            success: false,
            message: 'Lỗi server',
            error: error.message
        });
    }
};

const HISTORY_LIMITS = [20, 50, 100];
const HISTORY_TYPES = new Set([
    "create-veo",
    "token",
    "gen image api",
    "package",
    "text-to-speech",
    "remove-watermark-img",
    "remove-watermark-video",
    "create-video-motion",
    "enhance image",
    "chat-service",
    "gptphoto-image",
    "gptphoto-edit",
]);
const HISTORY_TYPE_ALIASES = {
    api: "gen image api",
};

const parseHistoryDate = (value, endOfDay) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
    const date = new Date(`${value} ${endOfDay ? "23:59:59" : "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const getRequestHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const isAdmin = Number(role) === 1;

        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 20;
        if (page < 1) page = 1;
        if (!HISTORY_LIMITS.includes(limit)) limit = 20;

        const offset = (page - 1) * limit;
        const where = {};

        if (!isAdmin) {
            where.userId = userId;
        } else {
            const q = String(req.query.q || "").trim().slice(0, 120);
            const legacyUserId = String(req.query.userId || "").trim();
            if (q) {
                const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
                const userWhere = {
                    [Op.or]: [
                        { name: { [Op.like]: like } },
                        { email: { [Op.like]: like } },
                    ],
                };
                if (/^\d+$/.test(q)) userWhere[Op.or].push({ id: Number(q) });
                const matched = await User.findAll({
                    where: userWhere,
                    attributes: ["id"],
                    raw: true,
                });
                if (!matched.length) {
                    return res.status(200).json({
                        success: true,
                        data: [],
                        pagination: {
                            totalItems: 0,
                            totalPages: 0,
                            currentPage: 1,
                            pageSize: limit,
                        },
                    });
                }
                where.userId = { [Op.in]: matched.map((row) => row.id) };
            } else if (/^\d+$/.test(legacyUserId)) {
                where.userId = Number(legacyUserId);
            }
        }

        const fromDate = parseHistoryDate(req.query.from, false);
        const toDate = parseHistoryDate(req.query.to, true);
        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt[Op.gte] = fromDate;
            if (toDate) where.createdAt[Op.lte] = toDate;
        }

        const requestedType = String(req.query.type || "").trim();
        const serviceType = HISTORY_TYPE_ALIASES[requestedType] || requestedType;
        if (HISTORY_TYPES.has(serviceType)) {
            if (serviceType === "package") {
                where[Op.or] = [
                    { serviceType: "package" },
                    { payType: "package" },
                ];
            } else {
                where.serviceType = serviceType;
            }
        }

        const { count, rows } = await RequestData.findAndCountAll({
            where,
            limit,
            offset,
            order: [["createTimeTask", "DESC"]],
        });

        let data = rows;
        if (isAdmin && rows.length) {
            const users = await User.findAll({
                where: { id: { [Op.in]: [...new Set(rows.map((row) => row.userId))] } },
                attributes: ["id", "name", "email"],
                raw: true,
            });
            const byId = new Map(users.map((item) => [item.id, item]));
            data = rows.map((row) => {
                const json = row.toJSON();
                json.user = byId.get(row.userId) || null;
                return json;
            });
        }

        return res.status(200).json({
            success: true,
            data,
            pagination: {
                totalItems: count,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                pageSize: limit,
            },
        });
    } catch (error) {
        console.error("Error fetching history:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
};


const getHope = async (req, res) => {
    return res.status(200).json({
        success: true,
        request: numberQuer,
        genvideo: requireGenvideo,
        image: requireImage,
        processing: runningVeoTasks,
        valiVideo: tokenVideoManager.getValidTokenCount(),
        valiImage: tokenImageManager.getValidTokenCount(),
        queue: veoQueue.length,
        countTasks: countTasks,
        logs: logsData
    })
}

const getPayment = async (req, res) => {
    try {
        const userIdSearch = req.query.userId || null;
        const statusSearch = req.query.status || null;
        const fromDate = req.query.fromDate || null;
        const toDate = req.query.toDate || null;

        let userId = req.user.id;
        const role = req.user.role;

        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 10;

        if (page < 1) page = 1;
        if (limit < 1) limit = 10;

        const offset = (page - 1) * limit;

        /** ======================
         * BUILD WHERE CONDITION
         ======================= */
        const where = {};

        // Phân quyền
        if (role != 1) {
            where.userId = userId;
        } else if (userIdSearch) {
            where.userId = userIdSearch;
        }

        // Lọc theo status
        if (statusSearch) {
            where.status = statusSearch;
        }

        // Lọc theo thời gian tạo
        if (fromDate && toDate) {
            where.createdAt = {
                [Op.between]: [
                    new Date(fromDate + " 00:00:00"),
                    new Date(toDate + " 23:59:59")
                ]
            };
        } else if (fromDate) {
            where.createdAt = {
                [Op.gte]: new Date(fromDate + " 00:00:00")
            };
        } else if (toDate) {
            where.createdAt = {
                [Op.lte]: new Date(toDate + " 23:59:59")
            };
        }

        /** ======================
         * QUERY DATA
         ======================= */
        const { count, rows } = await Payment.findAndCountAll({
            where,
            limit,
            offset,
            order: [["createdAt", "DESC"]],
        });

        /** ======================
         * TÍNH TỔNG AMOUNT
         ======================= */
        const totalAmount = await Payment.sum("amount", {
            where
        });

        const totalPages = Math.ceil(count / limit);

        return res.status(200).json({
            success: true,
            data: rows,
            summary: {
                totalAmount: totalAmount || 0
            },
            pagination: {
                totalItems: count,
                totalPages,
                currentPage: page,
                pageSize: limit
            }
        });

    } catch (error) {
        console.error("Error fetching payment:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
};

const createPaymentAuto = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { amount, paymentMethod } = req.body;

        // Validate user
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // Validate amount
        const paymentAmount = Number(amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Số tiền không hợp lệ"
            });
        }

        // Validate payment method
        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                message: "Payment method is required"
            });
        }

        // Check user tồn tại
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User không tồn tại"
            });
        }

        // (Tuỳ chọn) cộng tiền trực tiếp cho user
        const oldBalance = Number(user.balance || 0);
        user.balance = oldBalance + paymentAmount;
        await user.save();

        // Tạo payment
        const payment = await Payment.create({
            userId: user.id,
            amount: paymentAmount,
            paymentMethod,
            transactionCode: `PAY${Date.now()}`,
            description: "Nạp tiền tự động",
            status: 3 // COMPLETED
        });

        return res.status(201).json({
            success: true,
            message: "Nạp tiền thành công",
            data: {
                payment,
                balance: user.balance
            }
        });
    } catch (error) {
        console.error("createPaymentAuto error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
};

module.exports = {
    addTokenCaptcha,
    payToken,
    getBalance,
    getTokenAval,
    createVideoVeo3,
    getTaskStatus,
    checkTokenByPass,
    getRequestHistory,
    getHope,
    getBlockUser,
    unBlockUser,
    getPayment,
    createPaymentAuto
};