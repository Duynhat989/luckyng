
class GoogleFlowMedia {
    constructor(cookie, mediaId) {
        this.cookie = cookie;
        this.mediaId = mediaId;
        this.baseUrl = "https://flow.google.com";
    }

    async request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Cookie: this.cookie,
            },
            redirect: "follow",
        });

        const text = await response.text();

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        }

        return text;
    }

    /**
     * Tìm object window.WIZ_global_data trong HTML.
     * Xử lý đúng dấu ngoặc nằm bên trong chuỗi.
     */
    extractWizData(html) {
        const marker = "window.WIZ_global_data";
        const markerIndex = html.indexOf(marker);

        if (markerIndex === -1) {
            throw new Error("Không tìm thấy window.WIZ_global_data");
        }

        const equalIndex = html.indexOf("=", markerIndex + marker.length);
        const start = html.indexOf("{", equalIndex + 1);

        if (equalIndex === -1 || start === -1) {
            throw new Error("Không tìm thấy object WIZ_global_data");
        }

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < html.length; i++) {
            const char = html[i];

            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === "\\") {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
            } else if (char === "{") {
                depth++;
            } else if (char === "}") {
                depth--;

                if (depth === 0) {
                    return JSON.parse(html.slice(start, i + 1));
                }
            }
        }

        throw new Error("Object WIZ_global_data không hoàn chỉnh");
    }

    /**
     * Tìm các chuỗi trong object mà không phụ thuộc tên key.
     */
    findValues(data, predicate) {
        const results = [];
        const visited = new WeakSet();

        function walk(value, path = "") {
            if (typeof value === "string") {
                if (predicate(value)) {
                    results.push({ path, value });
                }
                return;
            }

            if (!value || typeof value !== "object") return;
            if (visited.has(value)) return;

            visited.add(value);

            for (const [key, child] of Object.entries(value)) {
                walk(child, path ? `${path}.${key}` : key);
            }
        }

        walk(data);
        return results;
    }

    /**
     * Tìm token dạng token:timestamp.
     * Không phụ thuộc tên key hay tiền tố AFfZ.
     */
    findAtToken(html, wizData) {
        const predicate = value =>
            /^[A-Za-z0-9_-]+:\d{13}$/.test(value);

        const candidates = this.findValues(wizData, predicate);

        if (candidates.length > 0) {
            return candidates[0].value;
        }

        // Dự phòng: tìm chuỗi token trong HTML nếu token không nằm
        // trực tiếp trong WIZ_global_data.
        const htmlMatches = html.match(
            /[A-Za-z0-9_-]+:\d{13}/g
        );

        if (htmlMatches?.length) {
            return htmlMatches[0];
        }

        throw new Error(
            "Không tìm thấy token AT theo định dạng token:timestamp. " +
            "Cần kiểm tra HTML thực tế để xác định nguồn token."
        );
    }

    async getAt() {
        const html = await this.request(`${this.baseUrl}/`);
        const wizData = this.extractWizData(html);
        const at = this.findAtToken(html, wizData);

        return { at, wizData };
    }

    /**
     * Tạo payload batchexecute.
     */
    buildPayload(at) {
        const fReq = JSON.stringify([
            [
                [
                    "as29s",
                    JSON.stringify([this.mediaId]),
                    null,
                    "generic",
                ],
            ],
        ]);

        const body = new URLSearchParams();
        body.set("f.req", fReq);
        body.set("at", at);

        return body.toString();
    }

    /**
     * Giải mã các lớp JSON lồng nhau trong response.
     */
    decodeResponse(text) {
        const results = [];
        const seen = new Set();

        function walk(value, depth = 0) {
            if (depth > 12 || value == null) return;

            if (typeof value === "string") {
                if (seen.has(value)) return;
                seen.add(value);

                results.push(value);

                const trimmed = value.trim();

                if (
                    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
                    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                    (trimmed.startsWith('"') && trimmed.endsWith('"'))
                ) {
                    try {
                        walk(JSON.parse(trimmed), depth + 1);
                    } catch {
                        // Chuỗi không phải JSON hợp lệ.
                    }
                }

                return;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    walk(item, depth + 1);
                }
                return;
            }

            if (typeof value === "object") {
                for (const item of Object.values(value)) {
                    walk(item, depth + 1);
                }
            }
        }

        // batchexecute có thể chứa nhiều dòng; thử parse từng dòng.
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                walk(JSON.parse(trimmed));
            } catch {
                walk(trimmed);
            }
        }

        return results;
    }

    /**
     * Trích URL video từ response.
     */
    extractVideoUrls(responseText) {
        const decoded = this.decodeResponse(responseText);
        const urls = new Set();

        const pattern =
            /https?:\\?\/\\?\/flow-content\.google\/video\/[^"'\\\s<>\]]+/g;

        for (const text of decoded) {
            const matches = text.match(pattern) || [];

            for (let url of matches) {
                url = url
                    .replace(/\\u003d/gi, "=")
                    .replace(/\\u0026/gi, "&")
                    .replace(/\\\//g, "/")
                    .replace(/\\+$/, "")
                    .replace(/[),;]+$/, "");
                if(url.includes('Signature=')) {
                    urls.add(url);
                }
            }
        }

        return [...urls];
    }

    /**
     * Request batchexecute để lấy thông tin media.
     */
    async getMediaUrl(at) {
        const endpoint =
            `${this.baseUrl}/_/AiSandboxAngularFrontend/data/batchexecute` +
            "?rpcids=as29s&hl=vi&rt=c";

        const responseText = await this.request(endpoint, {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded;charset=utf-8",
                Origin: this.baseUrl,
                Referer: `${this.baseUrl}/`,
            },
            body: this.buildPayload(at),
        });

        const videoUrls = this.extractVideoUrls(responseText);

        return {
            mediaId: this.mediaId,
            videoUrl: videoUrls[0] || null,
            videoUrls,
            raw: responseText,
        };
    }

    /**
     * Chạy toàn bộ quy trình.
     */
    async run() {
        const { at } = await this.getAt();
        const media = await this.getMediaUrl(at);
        return {
            videoUrl: media.videoUrls[0] || null
        };
    }
}

module.exports = GoogleFlowMedia;
