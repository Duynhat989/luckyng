const { v4: uuidv4 } = require("uuid");
const FlowAPI = require("../modules/flow_v3.module");
const { sendCallback } = require("../modules/web_hook.module");
const { sleep, getModelsV3, MODELS_V3_TIERS } = require("../utils/config.veo");

const statusTasks = new Map();
const taskMeta = new Map();

const TASK_TTL_MS = 2 * 60 * 60 * 1000; // thời gian clear data
const NANO_POLL_INTERVAL_MS = 5000;
const NANO_POLL_MAX_IMAGE = 120;
const NANO_POLL_MAX_VIDEO = 80;
const VIDEO_RENDER_POLL_MAX = 150;

const DEFAULT_IMAGE_RATIO = "IMAGE_ASPECT_RATIO_LANDSCAPE";
const DEFAULT_VIDEO_RATIO = "VIDEO_ASPECT_RATIO_LANDSCAPE";
const DEFAULT_IMAGE_MODEL = "GEM_PIX_2";

const resolveTier = (tier) => (tier === "pro" ? "pro" : "ultra");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clearTimeOut = (taskId) => {
    setTimeout(() => {
        statusTasks.delete(taskId);
        taskMeta.delete(taskId);
        console.log(`Task ${taskId} đã bị xoá sau ${TASK_TTL_MS / 60000} phút`);
    }, TASK_TTL_MS);
};

const setProcessing = (taskId, message = "Task is being processed") => {
    statusTasks.set(taskId, { success: false, code: "processing", message });
};

const normalizeTaskStatus = (status) => {
    if (!status || typeof status !== "object") {
        return {
            success: false,
            code: "error",
            message: "Unknown error",
            data: status,
        };
    }

    if (status.code === "processing") {
        return status;
    }

    if (status.code === "success" || status.code === "error") {
        return status;
    }

    if (status.success === true || status.message === "successfully") {
        return { ...status, code: status.code || "success" };
    }

    return {
        ...status,
        success: false,
        code: "error",
        message: status.message || status.error || "Task failed",
    };
};

const setTask = (taskId, status) => {
    const normalized = normalizeTaskStatus(status);
    statusTasks.set(taskId, normalized);

    if (normalized.code === "success" || normalized.code === "error") {
        const { userId } = taskMeta.get(taskId) || {};
        if (userId) {
            sendCallback(taskId, normalized).catch((err) =>
                console.error(`Webhook error [${taskId}]:`, err)
            );
        }
    }
};

const initTask = (taskId, userId) => {
    taskMeta.set(taskId, { userId });
    setProcessing(taskId);
};

const resolveImageRatio = (value) => value || DEFAULT_IMAGE_RATIO;

const resolveVideoRatio = (value) => value || DEFAULT_VIDEO_RATIO;

const resolveImageModel = (value) => value || DEFAULT_IMAGE_MODEL;

const createFlow = (accessToken, nanoToken, projectId) =>
    new FlowAPI({
        ACCESS_TOKEN: accessToken,
        NANO_KEY: nanoToken,
        projectId,
    });

const pollNanoTask = async (flow, nanoTaskId, maxAttempts) => {
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(NANO_POLL_INTERVAL_MS);
        const result = await flow._getRequestNANO(nanoTaskId);
        if (result.code !== "processing") {
            return result;
        }
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
                mediaUrl = await flow.getMediaUrl(media.name, cookie);
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


const runBackground = (taskId, fn) => {
    (async () => {
        try {
            await fn();
        } catch (err) {
            console.error("Background task error:", err);
            setTask(taskId, {
                success: false,
                code: "error",
                message: err.message || "Background task error",
                data: err,
            });
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
        initTask(taskId, req.user.id);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken);
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

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_IMAGE);
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
        });

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
        initTask(taskId, req.user.id);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken, projectId);
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

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_IMAGE);
            if (!getNano) {
                setTask(taskId, {
                    success: false,
                    code: "error",
                    message: "Timeout processing upscale image",
                });
                return;
            }

            setTask(taskId, getNano);
        });

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

    const taskId = uuidv4();
    const aspectRatio = resolveVideoRatio(ratioKey);

    try {
        const nanoToken = req.user.token;
        initTask(taskId, req.user.id);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken);
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

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_VIDEO);
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
        });

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
        initTask(taskId, req.user.id);

        runBackground(taskId, async () => {
            const flow = createFlow(accessToken, nanoToken, projectId);
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

            const getNano = await pollNanoTask(flow, nanoFlow.taskId, NANO_POLL_MAX_VIDEO);
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
        });

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


const enhancePhotoVer = async (req, res) => {
    return res.status(501).json({
        success: false,
        message: "enhance-photo chưa được bật trên server này",
    });
};

module.exports = {
    videoFlow,
    upscaleVideoFlow,
    imageFlow,
    upscaleImageFlow,
    getTask,
    getMediaLinkDownload,
    enhancePhotoVer,
};
