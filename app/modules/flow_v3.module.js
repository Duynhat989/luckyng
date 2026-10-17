const fetch = require("node-fetch");
const { v4: uuidv4 } = require("uuid");
const { parseBase64, VEO_3_1_FAST, VEO_3_1_FAST_LOWER } = require("../utils/config.veo");
const FLOW_FIX_BASE_URL = process.env.FLOW_FIX_BASE_URL;
class FlowAPI {
    constructor({
        ACCESS_TOKEN,
        NANO_KEY,
        projectId,
        baseNANO
    }) {
        this.ACCESS_TOKEN = ACCESS_TOKEN;
        this.NANO_KEY = NANO_KEY;
        this.projectId = projectId || uuidv4();
        this.baseURL = "https://aisandbox-pa.googleapis.com/v1/";
        this.baseNANO = baseNANO || FLOW_FIX_BASE_URL;
    }

    _getBaseHeaders() {
        return {
            "authorization": `Bearer ${this.ACCESS_TOKEN}`,
            "content-type": "application/json",
            "origin": "https://labs.google",
            "referer": "https://labs.google/",
            "user-agent": "Mozilla/5.0",
            "priority": "u=1, i",
            "sec-ch-ua": `"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"`,
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
        const res = await fetch(`${this.baseNANO}create-flow`, {
            method: "POST",
            headers: {
                "authorization": `Bearer ${this.NANO_KEY}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                flow_url: baseRequest.url,
                flow_auth_token: this.ACCESS_TOKEN,
                body_json: baseRequest.body
            })
        });

        const text = await res.text();

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    async _getRequestNANO(taskId) {
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
        aspectRatio = "VIDEO_ASPECT_RATIO_LANDSCAPE", //VIDEO_ASPECT_RATIO_PORTRAIT
        videoModel = "VEO_3_FAST",
        type = "frame"
    }) {

        const config = videoModel === "VEO_3_FAST"
            ? VEO_3_1_FAST[aspectRatio]
            : VEO_3_1_FAST_LOWER[aspectRatio];
        if (!config) {
            return {
                result: `Invalid request body`
            };
        }
        const baseRequest = {
            aspectRatio,
            seed: Math.floor(100000 + Math.random() * 900000),
            textInput: {
                structuredPrompt: {
                    parts: [{ text: promptText }]
                }
            },
            metadata: {}
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
                baseRequest.videoModelKey = config.model.text;

            } else if (imageInputs.length === 1) {
                url = "video:batchAsyncGenerateVideoStartImage";
                baseRequest.videoModelKey = config.model.i2t;

                baseRequest.startImage = {
                    mediaId: imageInputs[0]
                };

            } else if (imageInputs.length === 2) {
                url = "video:batchAsyncGenerateVideoStartAndEndImage";
                baseRequest.videoModelKey = config.model.i2t_fl;

                baseRequest.startImage = {
                    mediaId: imageInputs[0]
                };
                baseRequest.endImage = {
                    mediaId: imageInputs[1]
                };

            } else {
                throw new Error("Too many images in API Flow frame.");
            }

        } else {

            url = "video:batchAsyncGenerateVideoReferenceImages";
            baseRequest.videoModelKey = config.model.r2v;

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
        const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`
        try {

            const res = await fetch(url, {
                headers: { cookie }
            })
            return res.url
        } catch (error) {
            return `${url}|error`
        }
    }
}

module.exports = FlowAPI;