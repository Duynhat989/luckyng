class TokenCaptchaManager {
    constructor() {
        this.tokens = new Map();
        this.time = 25000; // 25 seconds
    }

    addToken(token) {
        if (this.tokens.has(token)) {
            return false;
        }
        this.tokens.set(token, Date.now());
        this.cleanExpiredTokens();
        return true;
    }

    getToken() {
        this.cleanExpiredTokens();
        for (const [token, timestamp] of this.tokens.entries()) {
            const age = Date.now() - timestamp;
            if (age < this.time) {
                this.tokens.delete(token);
                return {
                    token: token,
                    age: age
                };
            }
        }
        return null;
    }

    cleanExpiredTokens() {
        const now = Date.now();
        for (const [token, timestamp] of this.tokens.entries()) {
            if (now - timestamp >= this.time) {
                this.tokens.delete(token);
            }
        }
    }

    getValidTokenCount() {
        this.cleanExpiredTokens();
        return this.tokens.size;
    }
    clear() {
        this.tokens.clear();
    }
}

module.exports = {
    TokenCaptchaManager
};