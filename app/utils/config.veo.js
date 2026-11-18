const VEO_3_1_FAST = {
    VIDEO_ASPECT_RATIO_LANDSCAPE: {
        model: {
            text: "veo_3_1_t2v_fast_ultra",
            i2t: "veo_3_1_i2v_s_fast_ultra",
            i2t_fl: "veo_3_1_i2v_s_fast_ultra_fl",
            r2v: "veo_3_1_r2v_fast_landscape_ultra"
        },
        aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE"
    },
    VIDEO_ASPECT_RATIO_PORTRAIT: {
        model: {
            text: "veo_3_1_t2v_fast_portrait_ultra",
            i2t: "veo_3_1_i2v_s_fast_portrait_ultra",
            i2t_fl: "veo_3_1_i2v_s_fast_portrait_ultra_fl",
            r2v: "veo_3_1_r2v_fast_portrait_ultra"
        },
        aspectRatio: "VIDEO_ASPECT_RATIO_PORTRAIT"
    }
}

const VEO_3_1_FAST_LOWER = {
    VIDEO_ASPECT_RATIO_LANDSCAPE: {
        model: {
            text: "veo_3_1_t2v_fast_ultra_relaxed",
            i2t: "veo_3_1_i2v_s_fast_ultra_relaxed",
            i2t_fl: "veo_3_1_i2v_s_fast_fl_ultra_relaxed",
            r2v: "veo_3_1_t2v_fast_ultra"
        },
        aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE"
    },
    VIDEO_ASPECT_RATIO_PORTRAIT: {
        model: {
            text: "veo_3_1_t2v_fast_portrait_ultra_relaxed",
            i2t: "veo_3_1_i2v_s_fast_portrait_ultra_relaxed",
            i2t_fl: "veo_3_1_i2v_s_fast_portrait_fl_ultra_relaxed",
            r2v: "veo_3_1_r2v_fast_portrait_ultra"
        },
        aspectRatio: "VIDEO_ASPECT_RATIO_PORTRAIT"
    }
}
function formatBase64(base64String) {
    return base64String.replace(/^data:[^;]+;base64,/, "");
}
function parseBase64(base64String) {
    const match = base64String.match(/^data:(.+);base64,(.+)$/);

    if (!match) {
        throw new Error("Invalid base64 format");
    }

    const mimeType = match[1] || 'image/jpeg';
    const base64 = match[2];

    const ext = mimeType.split("/")[1];
    const fileName = `upload_idea_${Date.now()}.${ext}`;

    return {
        mimeType,
        base64,
        fileName
    };
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Model dùng suffix _{N}s theo length_seconds (mặc định 10, min 3, max 15) */
const OMNI_LENGTH_MODELS = new Set(["omniFlash", "omniFlashV2"]);
const OMNI_LENGTH_DEFAULT = 10;
const OMNI_LENGTH_MIN = 3;
const OMNI_LENGTH_MAX = 15;

const isOmniLengthModel = (videoModel) => OMNI_LENGTH_MODELS.has(String(videoModel || ""));

/**
 * Chuẩn hóa length_seconds cho omniFlash / omniFlashV2.
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 * value = null khi model không dùng độ dài động.
 */
const resolveOmniLengthSeconds = (videoModel, lengthSeconds) => {
    if (!isOmniLengthModel(videoModel)) {
        return { ok: true, value: null };
    }
    const raw =
        lengthSeconds === undefined || lengthSeconds === null || lengthSeconds === ""
            ? OMNI_LENGTH_DEFAULT
            : Number(lengthSeconds);
    if (!Number.isInteger(raw) || raw < OMNI_LENGTH_MIN || raw > OMNI_LENGTH_MAX) {
        return {
            ok: false,
            error: `invalid length_seconds. For ${videoModel} use integer ${OMNI_LENGTH_MIN}–${OMNI_LENGTH_MAX} (default ${OMNI_LENGTH_DEFAULT})`,
        };
    }
    return { ok: true, value: raw };
};

/** Gắn _{N}s vào key base (abra_t2v → abra_t2v_10s) */
const withOmniLengthSeconds = (modelKey, lengthSeconds) => {
    if (!modelKey || lengthSeconds == null) return modelKey;
    const base = String(modelKey).replace(/_\d+s$/i, "");
    return `${base}_${lengthSeconds}s`;
};

// Base keys (không có _Ns) — duration gắn lúc generate qua length_seconds
const modelsV3 = {
    omniFlashV2: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "macaron_cookie_t2v",
                imageToVideo: "macaron_cookie_i2v"
            },
            ingredient: {
                textToVideo: "macaron_cookie_t2v",
                referenceToVideo: "macaron_cookie_r2v"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "macaron_cookie_t2v",
                imageToVideo: "macaron_cookie_i2v"
            },
            ingredient: {
                textToVideo: "macaron_cookie_t2v",
                referenceToVideo: "macaron_cookie_r2v"
            }
        }
    },
    omniFlash: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "abra_t2v",
                imageToVideo: "abra_i2v"
            },
            ingredient: {
                textToVideo: "abra_t2v",
                referenceToVideo: "abra_r2v"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "abra_t2v",
                imageToVideo: "abra_i2v"
            },
            ingredient: {
                textToVideo: "abra_t2v",
                referenceToVideo: "abra_r2v"
            }
        }
    },

    veo3Lite: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "veo_3_1_t2v_lite",
                imageToVideo: "veo_3_1_i2v_lite",
                interpolation: "veo_3_1_interpolation_lite"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_lite",
                referenceToVideo: "veo_3_1_r2v_lite"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "veo_3_1_t2v_lite",
                imageToVideo: "veo_3_1_i2v_lite",
                interpolation: "veo_3_1_interpolation_lite"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_lite",
                referenceToVideo: "veo_3_1_r2v_lite"
            }
        }
    },

    veo3Fast: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "veo_3_1_t2v_fast_portrait_ultra",
                imageToVideo: "veo_3_1_i2v_s_fast_portrait_ultra",
                interpolation: "veo_3_1_i2v_s_fast_portrait_ultra_fl"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_fast_portrait_ultra",
                referenceToVideo: "veo_3_1_r2v_fast_portrait_ultra"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "veo_3_1_t2v_fast_ultra",
                imageToVideo: "veo_3_1_i2v_s_fast_ultra",
                interpolation: "veo_3_1_i2v_s_fast_ultra_fl"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_fast_ultra",
                referenceToVideo: "veo_3_1_r2v_fast_landscape_ultra"
            }
        }
    },

    veo3Quality: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "veo_3_1_t2v_portrait",
                imageToVideo: "veo_3_1_i2v_s_portrait",
                interpolation: "veo_3_1_i2v_s_portrait_fl"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_portrait"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "veo_3_1_t2v",
                imageToVideo: "veo_3_1_i2v_s",
                interpolation: "veo_3_1_i2v_s_fl"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v"
            }
        }
    },

    veo3LiteLowPriority: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "veo_3_1_t2v_lite_low_priority",
                imageToVideo: "veo_3_1_i2v_lite_low_priority",
                interpolation: "veo_3_1_interpolation_lite_low_priority"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_lite_low_priority",
                referenceToVideo: "veo_3_1_r2v_lite_low_priority"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "veo_3_1_t2v_lite_low_priority",
                imageToVideo: "veo_3_1_i2v_lite_low_priority",
                interpolation: "veo_3_1_interpolation_lite_low_priority"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_lite_low_priority",
                referenceToVideo: "veo_3_1_r2v_lite_low_priority"
            }
        }
    }
};

/** Pro tier — Omni Flash, Veo 3.1 Lite/Fast/Quality (không có ultra, không Lite low priority) */
const modelsV3Pro = {
    omniFlash: modelsV3.omniFlash,
    omniFlashV2: modelsV3.omniFlashV2,
    veo3Lite: modelsV3.veo3Lite,

    veo3Fast: {
        VIDEO_ASPECT_RATIO_PORTRAIT: {
            frame: {
                textToVideo: "veo_3_1_t2v_fast_portrait",
                imageToVideo: "veo_3_1_i2v_s_fast_portrait",
                interpolation: "veo_3_1_i2v_s_fast_portrait_fl"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_fast_portrait",
                referenceToVideo: "veo_3_1_r2v_fast_portrait"
            }
        },

        VIDEO_ASPECT_RATIO_LANDSCAPE: {
            frame: {
                textToVideo: "veo_3_1_t2v_fast",
                imageToVideo: "veo_3_1_i2v_s_fast",
                interpolation: "veo_3_1_i2v_s_fast_fl"
            },
            ingredient: {
                textToVideo: "veo_3_1_t2v_fast",
                referenceToVideo: "veo_3_1_r2v_fast_landscape"
            }
        }
    },

    veo3Quality: modelsV3.veo3Quality
};

const MODELS_V3_TIERS = ["ultra", "pro"];

const getModelsV3 = (tier = "ultra") =>
    tier === "pro" ? modelsV3Pro : modelsV3;

module.exports = {
    VEO_3_1_FAST,
    VEO_3_1_FAST_LOWER,
    formatBase64,
    parseBase64,
    sleep,
    modelsV3,
    modelsV3Pro,
    MODELS_V3_TIERS,
    getModelsV3,
    OMNI_LENGTH_MODELS,
    OMNI_LENGTH_DEFAULT,
    OMNI_LENGTH_MIN,
    OMNI_LENGTH_MAX,
    isOmniLengthModel,
    resolveOmniLengthSeconds,
    withOmniLengthSeconds,
}