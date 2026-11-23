const { v4: uuidv4 } = require("uuid");
const FlowAPI = require("../modules/flow_v3.module");
const veo = require("./veoController");
const { sendCallback } = require("../modules/web_hook.module");
const { V3TaskResult } = require("../models");
const { dbQueue } = require("../utils/dbQueue");
const {
    sleep,
    getModelsV3,
    MODELS_V3_TIERS,
    resolveOmniLengthSeconds,
} = require("../utils/config.veo");

const statusTasks = new Map();
const taskMeta = new Map();
const savedResults = new Set();
/** Task đang gọi nano / đang poll chờ kết quả (chỉ đếm inflight thật). */
const inflightV3 = new Set();

let countTasksV3 = 0;
const logsV3 = {
    success: 0,
    failed: 0,
    error: 0,
};

const isInProgressCode = (code) => code === "processing" || code === "queued";

const TASK_TTL_MS = 20 * 60 * 1000; // thời gian clear data
const NANO_POLL_INTERVAL_MS = 5000;
const NANO_POLL_MAX_IMAGE = 120;
const NANO_POLL_MAX_VIDEO = 80;
const VIDEO_RENDER_POLL_MAX = 150;

const DEFAULT_IMAGE_RATIO = "IMAGE_ASPECT_RATIO_LANDSCAPE";
const DEFAULT_VIDEO_RATIO = "VIDEO_ASPECT_RATIO_LANDSCAPE";

const TERMINAL_STATUSES = new Set(["success", "failed", "error"]);

const resolveTier = (tier) => (tier === "pro" ? "pro" : "ultra");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clearTimeOut = (taskId) => {
    setTimeout(() => {
        statusTasks.delete(taskId);
        taskMeta.delete(taskId);
        savedResults.delete(taskId);
        inflightV3.delete(taskId);
        console.log(`Task ${taskId} đã bị xoá sau ${TASK_TTL_MS / 60000} phút`);
    }, TASK_TTL_MS);
};

const setProcessing = (taskId, message = "Task is being processed") => {
    inflightV3.add(taskId);
    statusTasks.set(taskId, { success: false, code: "processing", message });
};

const safeResultJson = (value) => {
    try {
        return JSON.stringify(value, (_key, v) => {
            if (v instanceof Error) {
                return { message: v.message, name: v.name, stack: v.stack };
            }
            return v;
        });
    } catch (_err) {
        return JSON.stringify({ message: String(value) });
    }
};

const isHttpUrl = (value) =>
    typeof value === "string" && /^https?:\/\//i.test(value.trim());

/** Lấy url ảnh/video từ payload task (fifeUrl / mediaUrl / …) */
const extractMediaUrl = (status) => {
    if (!status || typeof status !== "object") return "";

    const bags = [status, status.data, status.result, status.data?.data].filter(
        (x) => x && typeof x === "object"
    );

    const keys = [
        "mediaUrl",
        "fifeUrl",
        "imageUrl",
        "videoUrl",
        "url",
        "linkVideo",
    ];

    for (const bag of bags) {
        for (const key of keys) {
            if (isHttpUrl(bag[key])) return bag[key].trim();
        }

        const fife = bag?.image?.generatedImage?.fifeUrl;
        if (isHttpUrl(fife)) return fife.trim();

        const medias = bag.media || bag.medias;
        if (Array.isArray(medias)) {
            for (const m of medias) {
                const nested =
                    m?.image?.generatedImage?.fifeUrl ||
                    m?.mediaUrl ||
                    m?.fifeUrl ||
                    m?.videoUrl ||
                    m?.url;
                if (isHttpUrl(nested)) return nested.trim();
            }
        }
    }

    return "";
};

/**
 * success = có url ảnh/video
 * failed  = không có url (gen xong nhưng thiếu link)
 * error   = exception / lỗi hệ thống
 */
const normalizeTaskStatus = (status, { exception = false } = {}) => {
    if (!status || typeof status !== "object") {
        return {
            success: false,
            code: "error",
            message: "Unknown error",
            data: status,
        };
    }

    if (isInProgressCode(status.code)) {
        return status;
    }

    if (exception) {
        return {
            ...status,
            success: false,
            code: "error",
            message: status.message || status.error || "Task error",
        };
    }

    const mediaUrl = extractMediaUrl(status);
    if (mediaUrl) {
        const data =
            status.data && typeof status.data === "object"
                ? { ...status.data }
                : {};
        if (!data.mediaUrl && !data.fifeUrl) {
            data.mediaUrl = mediaUrl;
        }
        return {
            ...status,
            success: true,
            code: "success",
            message: status.message || "Gen success",
            data,
        };
    }

    return {
        ...status,
        success: false,
        code: "failed",
        message: status.message || status.error || "No media url",
    };
};

const saveV3TaskResult = (taskId, status) => {
    if (savedResults.has(taskId)) return;
    savedResults.add(taskId);

    if (TERMINAL_STATUSES.has(status.code)) {
        logsV3[status.code] += 1;
    }

    const meta = taskMeta.get(taskId) || {};
    dbQueue
        .add(async () => {
            const { ensureV3TaskResultSchema } = require("../bootstrap/ensureV3TaskResultSchema");
            await ensureV3TaskResultSchema();
            return V3TaskResult.create({
                taskId,
                apiKeyId: meta.apiKeyId || null,
                status: status.code,
                result: safeResultJson(status),
            });
        })
        .catch((err) => {
            console.error("[v3TaskResult] save error:", err.message);
        });
};

const setTask = (taskId, status, options = {}) => {
    const normalized = normalizeTaskStatus(status, options);
    statusTasks.set(taskId, normalized);

    // queued/processing: vẫn đang chạy — không finalize, không bỏ inflight
    if (isInProgressCode(normalized.code)) {
        inflightV3.add(taskId);
        return;
    }

    if (TERMINAL_STATUSES.has(normalized.code)) {
        inflightV3.delete(taskId);
        saveV3TaskResult(taskId, normalized);

        const { userId } = taskMeta.get(taskId) || {};
        if (userId) {
            sendCallback(taskId, normalized).catch((err) =>
                console.error(`Webhook error [${taskId}]:`, err)
            );
        }
        try {
            require("../modules/enterpriseGate.module").notifyEnterpriseTask(taskId);
        } catch (_error) {
            // gate module is optional for tasks that are not enterprise
        }
    }
};

const initTask = (taskId, userId, apiKeyId = null) => {
    countTasksV3 += 1;
    taskMeta.set(taskId, { userId, apiKeyId: apiKeyId || null });
    setProcessing(taskId);
};

const countProcessingV3 = () => inflightV3.size;

const resolveImageRatio = (value) => value || DEFAULT_IMAGE_RATIO;

const resolveVideoRatio = (value) => value || DEFAULT_VIDEO_RATIO;

const resolveImageModel = (value) => value || DEFAULT_IMAGE_MODEL;

const invokeJson = (handler, req) => new Promise((resolve, reject) => {
    let done = false;
    const res = {
        statusCode: 200,
        headersSent: false,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.headersSent = true;
            if (!done) {
                done = true;
                resolve(body);
            }
            return this;
        },
    };
    Promise.resolve(handler(req, res)).catch((error) => {
        if (!done) reject(error);
    });
});

const attachEnterpriseTransport = (flow, enterprise, user) => {
    const nested = {
        taskId: enterprise.taskId,
        endpointKey: enterprise.endpointKey,
        dailyRemaining: enterprise.dailyRemaining,
        dailyUsed: enterprise.dailyUsed,
        dailyQuota: enterprise.dailyQuota,
        hold: true,
        nested: true,
        bindTask() { },
        onDone() { },
        onRefund() { return enterprise.onRefund?.(); },
    };
    flow.enterpriseCall = (payload) => invokeJson(veo.createVideoFlow, {
        user,
        enterprise: nested,
        body: payload,
        query: {},
    });
    flow.enterpriseStatus = (taskId) => invokeJson(veo.getTaskStatus, {
        user,
        enterprise: nested,
        body: {},
        query: { taskId },
    });
};

const createFlow = (accessToken, nanoToken, projectId, sourceReq) => {
    const flow = new FlowAPI({
        ACCESS_TOKEN: accessToken,
        NANO_KEY: nanoToken,
        projectId,
    });
    if (sourceReq?.enterprise && !sourceReq.enterprise.nested) {
        attachEnterpriseTransport(flow, sourceReq.enterprise, sourceReq.user);
    }
    return flow;
};

const pollNanoTask = async (flow, nanoTaskId, maxAttempts, taskId = "") => {
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(NANO_POLL_INTERVAL_MS);
        const result = await flow._getRequestNANO(nanoTaskId);
        // queued + processing = vẫn đang chờ nano/create-flow
        if (!isInProgressCode(result?.code)) {
            return result;
        }
        setProcessing(
            taskId,
            `Task is being processed [${result?.code || "processing"} ${i + 1}/${maxAttempts}]`
        );
    }
    return null;
};

const pollVideoRender = async (flow, mediaId, projectId, cookie, taskId, promptText) => {
    for (let i = 0; i < VIDEO_RENDER_POLL_MAX; i++) {
        await sleep(NANO_POLL_INTERVAL_MS);
        setProcessing(taskId, `Task is being processed [${i}]`);

        const status = await flow.getVideoStatus({ mediaId, projectId });
        const mediaList = status?.media;
        const generationStatus =
            mediaList?.[0]?.mediaMetadata?.mediaStatus?.mediaGenerationStatus;

        if (!generationStatus) continue;

        if (
            generationStatus === "MEDIA_GENERATION_STATUS_PENDING" ||
            generationStatus === "MEDIA_GENERATION_STATUS_ACTIVE"
        ) {
            continue;
        }

        if (generationStatus === "MEDIA_GENERATION_STATUS_SUCCESSFUL") {
            const media = mediaList[0];
            let mediaUrl = "";
            if (cookie) {
                mediaUrl = await flow.getMediaUrl(mediaId, cookie);
            }
            if (promptText) {
                // sendToSheet(taskId, mediaUrl, promptText);
            }
            return {
                success: true,
                code: "success",
                message: "Gen video success",
                data: {
                    mediaId: media.name,
                    projectId: media.projectId,
                    workflowId: media.workflowId,
                    mediaUrl,
                },
            };
        }

        return {
            success: false,
            code: "error",
            message: "Gen video error",
            data: status,
        };
    }

    return {
        success: false,
        code: "error",
        message: "Timeout Render",
    };
};

const uploadReferenceImages = async (flow, imageUrls, taskId, asReference = false) => {
    const imageInputs = [];

    try {
        const uploads = await Promise.all(
            imageUrls.map(async (imageUrl) => {
                const imgUpload = await flow.uploadImage(imageUrl);
                if (!imgUpload?.media?.name) {
                    throw { error: "Upload error", data: imgUpload };
                }
                if (asReference) {
                    return imgUpload.media.name;
                }
                return {
                    imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
                    name: imgUpload.media.name,
                };
            })
        );
        imageInputs.push(...uploads);
    } catch (err) {
        setTask(taskId, {
            success: false,
            code: "error",
            message: "Upload error",
            data: err.data || err,
        });
        return null;
    }

    return imageInputs;
};

const sendToSheet = async (taskId, baseUrl, prompt = "") => {
    try {
        const raw = JSON.stringify({
            func: "set",
            key: `${taskId}|${prompt}`,
            value: baseUrl,
        });

        fetch(
            "https://script.google.com/macros/s/AKfycbwqxtY2uXrcYEyYvQJnFL97Wv1SGGqlbD2AtXUEIpzs73ijk2i50VlyqAsuS7KCw_5Yaw/exec",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: raw,
                redirect: "follow",
            }
        )
            .then((r) => r.text())
            .then((result) => console.log(result))
            .catch((error) => console.error(error));
    } catch {
        // ignore sheet errors
    }
};

const runBackground = (taskId, fn, sourceReq) => {
    (async () => {
        try {
            if (sourceReq?.enterprise?.waitSlot) await sourceReq.enterprise.waitSlot();
            await fn();
        } catch (err) {
            console.error("Background task error:", err);
            setTask(
                taskId,
                {
                    success: false,
                    code: "error",
                    message: err.message || "Background task error",
                    data: { message: err.message, name: err.name },
                },
                { exception: true }
            );
        }
    })();
};

const acceptTask = (res, taskId) =>
    res.status(200).json({ success: true, taskId });

const serverError = (res, error) =>
    res.status(500).json({
        success: false,
        message: "Lỗi server",
        error: error.message,
    });

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

const imageFlow = async (req, res) => {
    const {
        accessToken,
        promptText,
        imageUrls = [],
        ratio: ratioKey = DEFAULT_IMAGE_RATIO,
        imageModel = DEFAULT_IMAGE_MODEL,
    } = req.body;

    if (!accessToken || !promptText) {
        return res.status(400).json({
            success: false,
            error: "invalid_params accessToken or promptText",
        });
    }

    const taskId = uuidv4();
    const aspectRatio = resolveImageRatio(ratioKey);
    const resolvedImageModel = resolveImageModel(imageModel);

    try {
        const nanoToken = req.user.token;
        initTask(taskId, req.user.id, req.apiKey?.id);
        if (req.enterprise) req.enterprise.taskId = taskId;
        if (req.enterprise?.bindTask) req.enterprise.bindTask(taskId);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken, undefined, req);
            const imageInputs = await uploadReferenceImages(
                flow,
                imageUrls,
                taskId,
                false
            );
            if (!imageInputs) return;

            const imgBody = await flow.generateImage({
                promptText,
                imageInputs,
                imageModel: resolvedImageModel,
                aspectRatio,
            });

            const nanoFlow = await flow._requestNANO(imgBody);
            if (!nanoFlow?.success) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Create nanoai error",
                    data: nanoFlow,
                });
                return;
            }

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_IMAGE, taskId);
            if (!getNano) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Timeout processing image",
                });
                return;
            }

            if (getNano.message === "successfully") {
                const medias = getNano?.result?.media;
                if (medias?.length > 0) {
                    setTask(taskId, {
                        success: true,
                        code: "success",
                        message: "Gen image success",
                        data: {
                            mediaId: medias[0]?.name,
                            projectId: getNano?.result?.workflows?.[0]?.name,
                            fifeUrl: medias[0]?.image?.generatedImage?.fifeUrl,
                            aspectRatio,
                            imageModel: resolvedImageModel,
                        },
                    });
                } else {
                    setTask(taskId, {
                        success: false,
                        code: "error",
                        message: "Gen image error",
                        data: getNano?.result,
                    });
                }
            } else {
                setTask(taskId, getNano);
            }
        }, req);

        return acceptTask(res, taskId);
    } catch (error) {
        return serverError(res, error);
    } finally {
        clearTimeOut(taskId);
    }
};

const upscaleImageFlow = async (req, res) => {
    const {
        accessToken,
        mediaId,
        projectId,
        targetResolution = "RESOLUTION_2K",
    } = req.body;

    if (!accessToken || !mediaId || !projectId) {
        return res.status(400).json({
            success: false,
            error: "invalid_params accessToken, mediaId or projectId",
        });
    }

    const taskId = uuidv4();

    try {
        const nanoToken = req.user.token;
        initTask(taskId, req.user.id, req.apiKey?.id);
        if (req.enterprise) req.enterprise.taskId = taskId;
        if (req.enterprise?.bindTask) req.enterprise.bindTask(taskId);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken, projectId, req);
            const imgBody = await flow.upscaleImage({ mediaId, targetResolution });
            const nanoFlow = await flow._requestNANO(imgBody);

            if (!nanoFlow?.success) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Create nanoai error",
                    data: nanoFlow,
                });
                return;
            }

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_IMAGE, taskId);
            if (!getNano) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Timeout processing upscale image",
                });
                return;
            }

            setTask(taskId, getNano);
        }, req);

        return acceptTask(res, taskId);
    } catch (error) {
        return serverError(res, error);
    } finally {
        clearTimeOut(taskId);
    }
};

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

const videoFlow = async (req, res) => {
    const {
        accessToken,
        promptText,
        imageUrls = [],
        ratio: ratioKey = DEFAULT_VIDEO_RATIO,
        videoModel = "veo3Fast",
        type = "frame",
        tier: tierInput = "ultra",
        cookie = "",
        length_seconds = 10,
    } = req.body;

    if (!accessToken || !promptText || !cookie) {
        return res.status(400).json({
            success: false,
            error: "invalid_params accessToken, promptText or cookie",
        });
    }

    const tier = resolveTier(tierInput);
    if (!MODELS_V3_TIERS.includes(tier)) {
        return res.status(400).json({
            success: false,
            error: `invalid tier. Available: ${MODELS_V3_TIERS.join(", ")}`,
        });
    }

    const modelsRegistry = getModelsV3(tier);
    const availableVideoModels = Object.keys(modelsRegistry);

    if (!modelsRegistry[videoModel]) {
        return res.status(400).json({
            success: false,
            error: `invalid videoModel for tier "${tier}". Available: ${availableVideoModels.join(", ")}`,
        });
    }

    const lengthResolved = resolveOmniLengthSeconds(videoModel, length_seconds);
    if (!lengthResolved.ok) {
        return res.status(400).json({
            success: false,
            error: lengthResolved.error,
        });
    }

    const taskId = uuidv4();
    const aspectRatio = resolveVideoRatio(ratioKey);

    try {
        const nanoToken = req.user.token;
        initTask(taskId, req.user.id, req.apiKey?.id);
        if (req.enterprise) req.enterprise.taskId = taskId;
        if (req.enterprise?.bindTask) req.enterprise.bindTask(taskId);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken, undefined, req);
            const imageInputs = await uploadReferenceImages(
                flow,
                imageUrls,
                taskId,
                true
            );
            if (imageInputs === null) return;

            const videoBody = await flow.generateVideo({
                promptText,
                imageInputs,
                aspectRatio,
                videoModel,
                type,
                tier,
                length_seconds: lengthResolved.value ?? 10,
            });

            if (!videoBody?.url) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: videoBody?.result || "Invalid video request",
                    data: videoBody,
                });
                return;
            }

            const nanoFlow = await flow._requestNANO(videoBody);
            if (!nanoFlow?.success) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Create nanoai error",
                    data: nanoFlow,
                });
                return;
            }

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_VIDEO, taskId);
            if (!getNano) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Timeout Captcha",
                });
                return;
            }

            if (!getNano.success) {
                setTask(taskId, getNano);
                return;
            }

            const medias = getNano?.result?.media;
            if (!medias?.length) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "No media in nano result",
                    data: getNano,
                });
                return;
            }

            const result = await pollVideoRender(
                flow,
                medias[0].name,
                medias[0].projectId,
                cookie,
                taskId,
                promptText
            );
            setTask(taskId, result);
        }, req);

        return acceptTask(res, taskId);
    } catch (error) {
        return serverError(res, error);
    } finally {
        clearTimeOut(taskId);
    }
};

const upscaleVideoFlow = async (req, res) => {
    const {
        accessToken,
        mediaId,
        projectId,
        workflowId = "",
        ratio: ratioKey = DEFAULT_VIDEO_RATIO,
        cookie = "",
    } = req.body;

    if (!accessToken || !mediaId || !projectId || !cookie) {
        return res.status(400).json({
            success: false,
            error: "invalid_params accessToken, mediaId, projectId or cookie",
        });
    }

    const taskId = uuidv4();
    const aspectRatio = resolveVideoRatio(ratioKey);

    try {
        const nanoToken = req.user.token;
        initTask(taskId, req.user.id, req.apiKey?.id);
        if (req.enterprise) req.enterprise.taskId = taskId;
        if (req.enterprise?.bindTask) req.enterprise.bindTask(taskId);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken, projectId, req);
            const videoBody = await flow.upscaleVideo({
                mediaId,
                workflowId,
                aspectRatio,
            });

            const nanoFlow = await flow._requestNANO(videoBody);
            if (!nanoFlow?.success) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Create nanoai error",
                    data: nanoFlow,
                });
                return;
            }

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_VIDEO, taskId);
            if (!getNano) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Timeout Captcha",
                });
                return;
            }

            if (!getNano.success) {
                setTask(taskId, getNano);
                return;
            }

            if (getNano?.result?.operations?.[0]?.rawBytes) {
                setTask(taskId, {
                    success: true,
                    code: "success",
                    message: "Gen video success",
                    data: {
                        rawBytes: getNano.result.operations[0].rawBytes,
                    },
                });
                return;
            }

            const medias = getNano?.result?.media;
            if (!medias?.length) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Create nanoai error",
                    data: getNano,
                });
                return;
            }

            const result = await pollVideoRender(
                flow,
                medias[0].name,
                medias[0].projectId,
                cookie,
                taskId
            );
            setTask(taskId, result);
        }, req);

        return acceptTask(res, taskId);
    } catch (error) {
        return serverError(res, error);
    } finally {
        clearTimeOut(taskId);
    }
};

// ---------------------------------------------------------------------------
// Task status
// ---------------------------------------------------------------------------

const getTask = async (req, res) => {
    try {
        const { taskId } = req.query;
        if (!taskId) {
            return res.status(400).json({
                success: false,
                message: "taskId is required",
            });
        }

        const status = statusTasks.get(taskId);
        if (!status) {
            return res.status(404).json({
                success: false,
                message: "Task not found",
            });
        }

        return res.status(200).json(status);
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};

const getMediaLinkDownload = async (req, res) => {
    const { accessToken, mediaId, cookie } = req.body;

    if (!accessToken || !mediaId || !cookie) {
        return res.status(400).json({
            success: false,
            error: "invalid_params accessToken, mediaId or cookie",
        });
    }

    try {
        const flow = createFlow(accessToken, req.user.token);
        const mediaUrl = await flow.getMediaUrl(mediaId, cookie);
        return res.status(200).json({ success: true, mediaUrl });
    } catch (error) {
        return serverError(res, error);
    }
};

/** Realtime v3 — không đụng /api/flow/request-hope */
const getHope = async (req, res) => {
    return res.status(200).json({
        success: true,
        processing: countProcessingV3(),
        countTasks: countTasksV3,
        logs: { ...logsV3 },
        // statusTasks còn giữ task đã xong (TTL) — không dùng làm "đang xử lý"
        activeTasks: statusTasks.size,
        inflight: inflightV3.size,
    });
};

module.exports = {
    videoFlow,
    upscaleVideoFlow,
    imageFlow,
    upscaleImageFlow,
    getTask,
    getMediaLinkDownload,
    getHope,
};
