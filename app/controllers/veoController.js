const { getSetupValue } = require("../services/setupCache.service");
const { getRuntimeStats } = require("../services/apiKeyRuntime.service");
const { TokenCaptchaManager } = require("../modules/captcha.module");
const { veo3Video } = require("../modules/veo3.module.js");
const { v4: uuidv4 } = require("uuid"); // Import UUID
const { TokenCaptchaImageManager } = require("../modules/captchaImage.module.js");
const { sendCallback } = require("../modules/web_hook.module.js");

const tokenVideoManager = new TokenCaptchaManager();
const tokenImageManager = new TokenCaptchaImageManager();
const rejectBrowserIds = new Set();
let countTokenNumber = 0
const addTokenCaptcha = async (req, res) => {
    try {
        const { tokenCaptcha, browserId, type = "video" } = req.body;
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
        if (type === "video") {
            countTokenNumber++;
            const added = tokenVideoManager.addToken(tokenCaptcha);
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
            const added = tokenImageManager.addToken(tokenCaptcha);
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
    try {
        const manager = isGenvideo ? tokenVideoManager : tokenImageManager;
        // Giống aiease getToken(); thêm event notify khi addToken (bỏ Array.from)
        return await manager.waitForToken(120 * 1000, 200);
    } finally {
        if (isGenvideo) requireGenvideo--;
        else requireImage--;
        numberQuer--;
    }
};

const getNewToken = async (req, res) => {
    const userId = req.user.id;
    const requireType = req.query.type || "video";
    const COST = 30;

    try {
        // 2️⃣ Lấy captcha token
        const token = await waitForTokenCaptcha(requireType === "video");
        if (!token) {
            throw { code: 408, message: "Captcha token timeout" };
        }
        const countTokens = tokenVideoManager.getValidTokenCount();
        console.log(`${userId} => Provided captcha token: `, countTokens);
        // 3️⃣ Thành công
        // saveRequestData({
        //     userId,
        //     content: JSON.stringify({
        //         cost: COST,
        //         type: "token",
        //         msg: "Get token success"
        //     })
        // })

        return res.status(200).json({
            success: true,
            token: token.token,
            age: token.age,
            countTokens: countTokens
        });

    } catch (error) {

        return res.status(error.code || 500).json({
            success: false,
            message: error.message || "Internal server error"
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



const MAX_VEO_TASK = 400;
const RETRY = 150;

/* ===================== QUEUE CORE ===================== */

let runningVeoTasks = 0;
let veoQueue = [];
const statusTasks = new Map();

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
    try {
        const { flow_auth_token, body_json, flow_url, is_proxy = false, proxy = "" } = req.body;

        if (!body_json) return res.status(400).json({ success: false, message: "body_json is required" });
        if (!flow_auth_token) return res.status(400).json({ success: false, message: "flow_auth_token is required" });
        if (!flow_url) return res.status(400).json({ success: false, message: "flow_url is required" });

        countTasks++;
        /* ====== INIT TASK ====== */
        const taskId = uuidv4();

        statusTasks.set(taskId, {
            success: false,
            code: "queued",
            message: "Task is waiting in queue"
        });

        /* ====== CREATE QUEUE TASK ====== */
        const createTask = async () => {
            try {
                statusTasks.set(taskId, {
                    success: false,
                    code: "processing",
                    message: "Task is being processed"
                });

                for (let attempt = 1; attempt <= RETRY; attempt++) {
                    const isImage = flow_url.includes("batchGenerateImages") || flow_url.includes("upsampleImage");
                    const token = await waitForTokenCaptcha(!isImage);
                    if (!token) continue;
                    if (body_json?.clientContext?.recaptchaContext) {
                        try {
                            body_json.clientContext.recaptchaContext.token = token.token
                        } catch (error) {
                            console.error("Error setting recaptchaContext token:", error);
                        }
                    } else {
                        try { body_json.clientContext = { recaptchaToken: token.token }; } catch { }
                    }
                    if (flow_url.includes("batchGenerateImages")) {
                        for (let i = 0; i < body_json.requests.length; i++) {
                            if (body_json.requests[i]?.clientContext?.recaptchaContext) {
                                try { body_json.requests[i].clientContext.recaptchaContext.token = token.token; } catch (error) {
                                    console.error("Error setting recaptchaContext token for image:", error);
                                }
                            } else {
                                try { body_json.requests[i].clientContext.recaptchaToken = token.token; } catch { }
                            }
                        }
                    }

                    const veo3 = new veo3Video(flow_auth_token, is_proxy, proxy)
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

                    sendCallback(taskId, {
                        taskId,
                        success: true,
                        message: "successfully",
                        result
                    })
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


                sendCallback(taskId, {
                    success: false,
                    code: "failed",
                    message: "All attempts failed",
                    isRefund: true
                })
                logsData.error += 1

            } catch (err) {

                logsData.error += 1
                statusTasks.set(taskId, {
                    success: false,
                    code: "error",
                    message: err.message
                });

                sendCallback(taskId, {
                    success: false,
                    code: "error",
                    message: err.message
                })
                throw err;
            }
            finally {
                setTimeout(() => {
                    clearData(taskId)
                }, 60 * 100 * 1000)
            }
        };
        veoQueue.push(createTask);
        runVeoQueue();
        return res.status(200).json({
            success: true,
            taskId
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
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
        try {
            statusTasks.delete(taskId);
        } catch (error) { }
    }, 5 * 60 * 1000);
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
        if (status && !["processing", "queued"].includes(status?.code)) {
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
            const body_json =
            {
                "mediaGenerationContext": {
                    "batchId": "225ac5ce-dcd8-4a33-960a-6d9ded2428e6"
                },
                "clientContext": {
                    "projectId": "8c7c478a-6454-4081-a049-33010c47e7ae",
                    "tool": "PINHOLE",
                    "userPaygateTier": "PAYGATE_TIER_NOT_PAID",
                    "sessionId": ";1772279180519",
                    "recaptchaContext": {
                        "token": token,
                        "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                    }
                },
                "requests": [{
                    "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
                    "seed": 13819,
                    "textInput": {
                        "structuredPrompt": {
                            "parts": [{
                                "text": "xin chào"
                            }]
                        }
                    },
                    "videoModelKey": "veo_3_1_t2v_fast",
                    "metadata": {}
                }],
                "useV2ModelConfig": true
            }
            const flow_url = "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
            const apiKeyValue = await getSetupValue("API_KEY");

            if (!apiKeyValue) {
                return res.status(403).json({
                    success: true,
                    code: "captcha",
                    message: 'Captcha Veo hết hạn'
                });
            }
            var veo3 = new veo3Video(apiKeyValue, false);
            const result = await veo3.generateVideo(body_json, flow_url);
            if (JSON.stringify(result).includes("reCAPTCHA")) {
                console.log("Captcha failed")
                rejectBrowserIds.add(browserId);
                return res.status(403).json({
                    success: false,
                    code: "captcha",
                    message: 'Browser ID bị từ chối'
                });
            }
            console.log("Bypass :", JSON.stringify(result));
            console.log("Captcha Success, ", browserId)
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
        countTokenNumber: countTokenNumber,
        logs: logsData,
        runtime: getRuntimeStats(),
    })
}
const clearTemplate = async (req, res) => {
    veoQueue = []
    return res.status(200).json({

    })
}

module.exports = {
    addTokenCaptcha,
    getNewToken,
    getTokenAval,
    createVideoVeo3,
    getTaskStatus,
    checkTokenByPass,
    getHope
};