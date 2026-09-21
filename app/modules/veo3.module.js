const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

class veo3Video {
    constructor(access_token = "", is_proxy = false, proxy = "") {
        this.access_token = access_token;
        this.agent = null;
        if (is_proxy && proxy) {
            this.agent = this.buildProxyAgent(proxy);
        }
    }

    buildProxyAgent(proxy) {
        const parts = proxy.split(":");

        if (parts.length === 2) {
            const [host, port] = parts;
            const url = `http://${host}:${port}`;
            console.log("[PROXY] Using:", url);
            return new HttpsProxyAgent(url);
        }

        if (parts.length === 4) {
            const [host, port, user, pass] = parts;
            const url = `http://${user}:${pass}@${host}:${port}`;
            console.log("[PROXY] Using:", `http://${user}:******@${host}:${port}`);
            return new HttpsProxyAgent(url);
        }

        console.warn("[PROXY] Invalid proxy format:", proxy);
        return null;
    }

    async generateVideo(bodyJson, urlRequest) {
        const headers = {
            "authorization": `Bearer ${this.access_token}`,
            "content-type": "text/plain;charset=UTF-8",
            "origin": "https://labs.google",
            "referer": "https://labs.google/",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
            "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
        };

        try {
            const options = {
                method: "POST",
                headers,
                body: JSON.stringify(bodyJson),
            };

            // QUAN TRỌNG: Chỉ thêm agent khi có proxy
            if (this.agent) {
                options.agent = this.agent;
            }

            const response = await fetch(urlRequest, options);
            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error.message || JSON.stringify(error)
            };
        }
    }
}

module.exports = { veo3Video };
