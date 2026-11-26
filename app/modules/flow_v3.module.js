const fetch = require("node-fetch");
const { v4: uuidv4 } = require("uuid");
const {
    parseBase64,
    getModelsV3,
    isOmniLengthModel,
    withOmniLengthSeconds,
} = require("../utils/config.veo");

const GoogleFlowMedia = require('./extract.module.js');
const DEFAULT_VIDEO_RATIO = "VIDEO_ASPECT_RATIO_LANDSCAPE";

/** local = gọi /api/flow của chính app; nano = gọi flow-api.nanoai.pics */
const FLOW_FIX_PRESETS = {
    local: {
        baseUrl: "http://localhost:2053/api/fix/",
        useCallerKey: true,
    },
    nano: {
        baseUrl: "https://flow-api.nanoai.pics/api/fix/",
        useCallerKey: false,
    },
};

const normalizeBaseUrl = (raw) => {
    const value = String(raw || "").trim();
    if (!value) return "";
    return value.endsWith("/") ? value : `${value}/`;
};

/**
 * FLOW_FIX_PROVIDER=local|nano
 * FLOW_FIX_BASE_URL  — override URL (optional)
 * FLOW_FIX_API_KEY   — bắt buộc khi provider=nano (key remote)
 */
const resolveFlowFixConfig = (callerToken) => {
    const provider = String(process.env.FLOW_FIX_PROVIDER || "local")
        .trim()
        .toLowerCase();
    const preset = FLOW_FIX_PRESETS[provider] || FLOW_FIX_PRESETS.local;
    const envBase = normalizeBaseUrl(process.env.FLOW_FIX_BASE_URL);
    // Ưu tiên URL theo provider; FLOW_FIX_BASE_URL chỉ override khi không conflict localhost↔nano
    let baseNANO = normalizeBaseUrl(preset.baseUrl);
    if (envBase) {
        const envIsLocal = /localhost|127\.0\.0\.1/.test(envBase);
        if (provider === "nano" && envIsLocal) {
            baseNANO = normalizeBaseUrl(preset.baseUrl);
        } else if (provider === "local" && !envIsLocal && /nanoai\.pics/.test(envBase)) {
            baseNANO = normalizeBaseUrl(preset.baseUrl);
        } else {
            baseNANO = envBase;
        }
    }

    let NANO_KEY = callerToken || "";
    if (!preset.useCallerKey) {
        NANO_KEY = String(process.env.FLOW_FIX_API_KEY || "").trim() || NANO_KEY;
    }

    return { provider, baseNANO, NANO_KEY };
};

const resolveVideoAspectRatio = (aspectRatio) => aspectRatio || DEFAULT_VIDEO_RATIO;

const resolveVideoModelKey = (modelGroup, aspectRatio, type, imageCount) => {
    const ar = resolveVideoAspectRatio(aspectRatio);
    const typeConfig = modelGroup?.[ar]?.[type];
    if (!typeConfig) return null;

    if (type === "frame") {
        if (imageCount === 0) return typeConfig.textToVideo;
        if (imageCount === 1) return typeConfig.imageToVideo;
        if (imageCount === 2) return typeConfig.interpolation;
        return null;
    }

    if (imageCount === 0) return typeConfig.textToVideo;
    return typeConfig.referenceToVideo || typeConfig.imageToVideo;
};

class FlowAPI {
    constructor({
        ACCESS_TOKEN,
        NANO_KEY,
        projectId,
        baseNANO
    }) {
        this.ACCESS_TOKEN = ACCESS_TOKEN;
        this.projectId = projectId || uuidv4();
        this.baseURL = "https://aisandbox-pa.googleapis.com/v1/";

        const resolved = resolveFlowFixConfig(NANO_KEY);
        this.flowFixProvider = resolved.provider;
        this.NANO_KEY = resolved.NANO_KEY;
        this.baseNANO = normalizeBaseUrl(baseNANO) || resolved.baseNANO;
    }

    _getBaseHeaders() {
        return {
            "authorization": `Bearer ${this.ACCESS_TOKEN}`,
            "content-type": "application/json",
            "origin": "https://labs.google",
            "referer": "https://labs.google/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "priority": "u=1, i",
            "sec-ch-ua": `"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"`,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": `"Windows"`,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
            "x-browser-channel": "stable",
            "x-browser-year": "2026"
        };
    }

    async _request(path, options = {}) {
        const res = await fetch(`${this.baseURL}${path}`, {
            ...options,
            headers: {
                ...this._getBaseHeaders(),
                ...(options.headers || {})
            }
        });

        const text = await res.text();

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    async _requestNANO(baseRequest) {
        const payload = {
            flow_url: baseRequest.url,
            flow_auth_token: this.ACCESS_TOKEN,
            body_json: baseRequest.body,
            type_source:"nguyen"
        };
        if (typeof this.enterpriseCall === "function") {
            return this.enterpriseCall(payload);
        }
        const res = await fetch(`${this.baseNANO}create-flow`, {
            method: "POST",
            headers: {
                "authorization": `Bearer ${this.NANO_KEY}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(payload)
        });

        const text = await res.text();

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    async _getRequestNANO(taskId) {
        if (typeof this.enterpriseStatus === "function") {
            return this.enterpriseStatus(taskId);
        }
        const res = await fetch(`${this.baseNANO}task-status?taskId=${taskId}`, {
            method: "GET",
            headers: {
                "authorization": `Bearer ${this.NANO_KEY}`,
                "content-type": "application/json",
            }
        });

        const text = await res.text();

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    // =========================
    // Credits
    // =========================

    async getCredits() {
        return this._request("credits", {
            method: "GET"
        });
    }

    // =========================
    // Upload
    // =========================

    async uploadImage(base64String) {
        const { mimeType, base64, fileName } = parseBase64(base64String);
        return this._request("flow/uploadImage", {
            method: "POST",
            body: JSON.stringify({
                clientContext: {
                    projectId: this.projectId,
                    tool: "PINHOLE"
                },
                imageBytes: base64,
                isUserUploaded: true,
                isHidden: false,
                mimeType,
                fileName
            })
        });
    }

    // =========================
    // Image Generation
    // =========================

    async generateImage({
        promptText,
        imageInputs = [],
        imageModel = "GEM_PIX_2",
        aspectRatio = "IMAGE_ASPECT_RATIO_LANDSCAPE"
    }) {
        const sessionId = ";" + Date.now();

        const baseRequest = {
            clientContext: {
                recaptchaContext: {
                    token: "",
                    applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                },
                projectId: this.projectId,
                tool: "PINHOLE",
                sessionId
            },
            imageModelName: imageModel,
            imageAspectRatio: aspectRatio,
            structuredPrompt: {
                parts: [{ text: promptText }]
            },
            seed: Math.floor(100000 + Math.random() * 900000),
            imageInputs
        };

        const baseBody = {
            mediaGenerationContext: {
                batchId: uuidv4()
            },
            clientContext: {
                projectId: this.projectId,
                tool: "PINHOLE",
                userPaygateTier: "PAYGATE_TIER_TWO",
                sessionId,
                recaptchaContext: {
                    token: "",
                    applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            requests: [baseRequest],
            useNewMedia: true
        };

        return {
            url: `${this.baseURL}projects/${this.projectId}/flowMedia:batchGenerateImages`,
            body: baseBody
        };
    }

    async upscaleImage({
        mediaId,
        targetResolution = "RESOLUTION_2K"
    }) {
        const sessionId = ";" + Date.now();
        return {
            url: `${this.baseURL}flow/upsampleImage`,
            body: {
                mediaId,
                targetResolution: `UPSAMPLE_IMAGE_${targetResolution}`,
                clientContext: {
                    recaptchaContext: {
                        token: "",
                        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                    },
                    projectId: this.projectId,
                    tool: "PINHOLE",
                    userPaygateTier: "PAYGATE_TIER_TWO",
                    sessionId
                }
            }
        };
    }

    // =========================
    // Video Generation
    // =========================

    async generateVideo({
        promptText,
        imageInputs = [],
        aspectRatio = "VIDEO_ASPECT_RATIO_LANDSCAPE",
        videoModel = "veo3Fast",
        type = "frame",
        tier = "ultra",
        length_seconds = 10,
    }) {
        const modelsRegistry = getModelsV3(tier);
        const modelGroup = modelsRegistry[videoModel];
        if (!modelGroup) {
            return { result: `Invalid videoModel: ${videoModel}` };
        }

        const resolvedAspectRatio = resolveVideoAspectRatio(aspectRatio);
        let videoModelKey = resolveVideoModelKey(
            modelGroup,
            aspectRatio,
            type,
            imageInputs.length
        );

        if (!videoModelKey) {
            return { result: `Invalid request: ${videoModel}/${resolvedAspectRatio}/${type}/${imageInputs.length} image(s)` };
        }

        if (isOmniLengthModel(videoModel)) {
            videoModelKey = withOmniLengthSeconds(videoModelKey, length_seconds);
        }

        const baseRequest = {
            aspectRatio: resolvedAspectRatio,
            seed: Math.floor(100000 + Math.random() * 900000),
            textInput: {
                structuredPrompt: {
                    parts: [{ text: promptText }]
                }
            },
            metadata: {},
            videoModelKey
        };

        const baseBody = {
            mediaGenerationContext: {
                batchId: uuidv4()
            },
            clientContext: {
                projectId: this.projectId,
                tool: "PINHOLE",
                userPaygateTier: "PAYGATE_TIER_TWO",
                sessionId: ";" + Date.now(),
                recaptchaContext: {
                    token: "",
                    applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            requests: [],
            useV2ModelConfig: true
        };

        let url = "";

        if (type === "frame") {
            if (imageInputs.length === 0) {
                url = "video:batchAsyncGenerateVideoText";
            } else if (imageInputs.length === 1) {
                url = "video:batchAsyncGenerateVideoStartImage";
                baseRequest.startImage = { mediaId: imageInputs[0] };
            } else if (imageInputs.length === 2) {
                url = "video:batchAsyncGenerateVideoStartAndEndImage";
                baseRequest.startImage = { mediaId: imageInputs[0] };
                baseRequest.endImage = { mediaId: imageInputs[1] };
            } else {
                throw new Error("Too many images in API Flow frame.");
            }
        } else if (imageInputs.length === 0) {
            url = "video:batchAsyncGenerateVideoText";
        } else {
            url = "video:batchAsyncGenerateVideoReferenceImages";
            baseRequest.referenceImages = imageInputs.map(id => ({
                mediaId: id,
                imageUsageType: "IMAGE_USAGE_TYPE_ASSET"
            }));
        }

        baseBody.requests = [baseRequest];

        return {
            url: `${this.baseURL}${url}`,
            body: baseBody
        };
    }

    async upscaleVideo({
        mediaId,
        workflowId,
        aspectRatio = 'VIDEO_ASPECT_RATIO_LANDSCAPE'
    }) {
        const sessionId = ";" + Date.now();

        return {
            url: `${this.baseURL}video:batchAsyncGenerateVideoUpsampleVideo`,
            body: {
                mediaGenerationContext: {
                    batchId: uuidv4()
                },
                clientContext: {
                    projectId: this.projectId,
                    tool: "PINHOLE",
                    userPaygateTier: "PAYGATE_TIER_TWO",
                    sessionId,
                    recaptchaContext: {
                        token: "",
                        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
                    }
                },
                requests: [{
                    resolution: "VIDEO_RESOLUTION_1080P",
                    aspectRatio,
                    seed: Math.floor(100000 + Math.random() * 900000),
                    videoModelKey: "veo_3_1_upsampler_1080p",
                    metadata: {
                        workflowId: workflowId
                    },
                    videoInput: {
                        mediaId
                    }
                }],
                useV2ModelConfig: true
            }
        };
    }

    // =========================
    // Task Status
    // =========================

    async getVideoStatus({ mediaId, projectId }) {
        return this._request(`video:batchCheckAsyncVideoGenerationStatus`, {
            method: "POST",
            body: JSON.stringify({
                media: [{
                    name: mediaId,
                    projectId
                }]
            })
        });
    }
    // Load link video

    async getMediaUrl(mediaId, cookie) {
        try {
            const googleFlowMedia = new GoogleFlowMedia(
                cookie,
                mediaId
            );

            const media = await googleFlowMedia.run();
            return media.videoUrl || `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`;
        } catch (error) {
            return `${error}|error|https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`
        }
    }
}

module.exports = FlowAPI;
