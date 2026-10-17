const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

class veo3Video {
    constructor(access_token = "", is_proxy = false, proxy = "", userAgent = "", secChUa = "") {
        this.access_token = access_token;
        this.agent = null;
        this.agent = this.buildProxyAgent(proxy);
        if (proxy) {
        }
        this.userAgent = userAgent;
        this.secChUa = secChUa;
        // console.log("[USER AGENT] :", `${this.userAgent}|${this.secChUa}`);
    }


    buildProxyAgent(proxy) {

        const newProxy = "92.113.90.35:46840:q3l7YsGpZi8ddwO:iMh6H5Vf7688TSO"

        const parts = newProxy.split(":");

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
            "sec-ch-ua": this.secChUa || '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "user-agent": this.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
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
            console.log("result :", JSON.stringify(result));
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
