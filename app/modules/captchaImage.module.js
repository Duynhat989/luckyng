class TokenCaptchaImageManager {
    constructor() {
        this.tokens = new Map();
        this.time = 25000; // giống aiease
        /** @type {Array<() => void>} */
        this.waiters = [];
    }

    addToken(token) {
        if (this.tokens.has(token)) {
            return false;
        }
        this.tokens.set(token, Date.now());
        this.cleanExpiredTokens();
        this._notifyWaiters();
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

    getNewToken() {
        return this.getToken();
    }

    waitForToken(timeoutMs = 120000, pollMs = 200) {
        return new Promise((resolve) => {
            let settled = false;
            let intervalId;
            let timeoutId;

            const cleanup = () => {
                if (intervalId) clearInterval(intervalId);
                if (timeoutId) clearTimeout(timeoutId);
                const idx = this.waiters.indexOf(tryResolve);
                if (idx !== -1) this.waiters.splice(idx, 1);
            };

            const finish = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const tryResolve = () => {
                const token = this.getToken();
                if (token) finish(token);
            };

            tryResolve();
            if (settled) return;

            this.waiters.push(tryResolve);
            intervalId = setInterval(tryResolve, pollMs);
            timeoutId = setTimeout(() => finish(null), timeoutMs);
        });
    }

    _notifyWaiters() {
        if (!this.waiters.length) return;
        const pending = this.waiters.slice();
        for (const fn of pending) {
            try {
                fn();
            } catch (_) { /* ignore */ }
        }
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
        this.waiters = [];
    }
}

module.exports = {
    TokenCaptchaImageManager
};
