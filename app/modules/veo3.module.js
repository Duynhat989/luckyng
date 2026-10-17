
const { fetch, ProxyAgent } = require("undici");

class veo3Video {
    constructor(
        access_token = "",
        is_proxy = false,
        proxy = "",
        userAgent = "",
        secChUa = ""
    ) {
        this.access_token = access_token;
        this.dispatcher = null;
        this.userAgent = userAgent;
        this.secChUa = secChUa;
        this.proxy = "92.113.90.35:46840:q3l7YsGpZi8ddwO:iMh6H5Vf7688TSO";
        // Chỉ dùng proxy khi được bật rõ ràng.
        if (this.proxy) {
            this.dispatcher = new ProxyAgent(
                this.buildProxyUrl(this.proxy)
            );
        }

        console.log("[HTTP CLIENT] undici");
        console.log("[PROXY ENABLED]", Boolean(this.dispatcher));
    }

    buildProxyUrl(proxy) {
        // Format: host:port hoặc host:port:user:pass
        const parts = proxy.split(":");

        if (parts.length === 2) {
            const [host, port] = parts;
            return `http://${host}:${port}`;
        }

        if (parts.length === 4) {
            const [host, port, username, password] = parts;

            return `http://${encodeURIComponent(username)}:${
                encodeURIComponent(password)
            }@${host}:${port}`;
        }

        throw new Error("Invalid proxy format");
    }

    async generateVideo(bodyJson, urlRequest) {
        const headers = {
            authorization: `Bearer ${this.access_token}`,
            "content-type": "application/json",
        };

        if (this.userAgent) {
            headers["user-agent"] = this.userAgent;
        }

        // Chỉ thêm Client Hints khi endpoint thực sự cần.
        if (this.secChUa) {
            headers["sec-ch-ua"] = this.secChUa;
        }

        const options = {
            method: "POST",
            headers,
            body: JSON.stringify(bodyJson),
            signal: AbortSignal.timeout(60_000),
        };

        // Undici dùng dispatcher thay cho agent.
        if (this.dispatcher) {
            options.dispatcher = this.dispatcher;
        }

        try {
            const response = await fetch(urlRequest, options);
            const text = await response.text();

            let data;

            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }

            if (!response.ok) {
                return {
                    success: false,
                    status: response.status,
                    error: "HTTP request failed",
                    data,
                };
            }

            return data;
        } catch (error) {
            return {
                success: false,
                error: error.message,
                code: error.code || error.cause?.code || null,
                name: error.name,
            };
        }
    }

    async close() {
        if (this.dispatcher) {
            await this.dispatcher.close();
            this.dispatcher = null;
        }
    }
}

module.exports = { veo3Video };
