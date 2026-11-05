const axios = require('axios');
const fs = require('fs');
const path = require('path');

class BoostyClient
{
    MAX_PAGE_SIZE = 100;
    MAX_SUBSCRIBERS = 10000;
    MAX_PAGES = 100;

    constructor(apiKey, { request = axios } = {}) {
        this.apiKey = String(apiKey || this.getTokenFromFile() || '').trim();
        this.request = request;
    }

    async getSubscriberRecords(limit = 1000, { requireComplete = false } = {}) {
        const requestedLimit = Math.max(1, Math.min(this.MAX_PAGE_SIZE, Math.floor(Number(limit) || 1000)));
        if (!this.apiKey) {
            throw new Error('Boosty API token is not configured');
        }

        const subscribers = [];
        const seenIds = new Set();
        let expectedTotal = null;
        let offset = 0;
        for (let page = 0; page < this.MAX_PAGES; page += 1) {
            const payload = await this.fetchSubscriberPage(requestedLimit, offset);
            if (!Array.isArray(payload.data)) throw new Error('Boosty returned an invalid subscriber list');
            const total = Number(payload.total);
            const hasTotal = payload.total !== null && payload.total !== undefined
                && String(payload.total).trim() !== '' && Number.isSafeInteger(total) && total >= 0;

            if (requireComplete && !hasTotal) {
                throw new Error('Boosty returned an incomplete subscriber list');
            }
            if (hasTotal) {
                if (total > this.MAX_SUBSCRIBERS) throw new Error('Boosty subscriber list exceeds the supported size');
                if (expectedTotal !== null && total !== expectedTotal) {
                    throw new Error('Boosty subscriber list changed during pagination');
                }
                expectedTotal = total;
            }
            if (payload.data.length > requestedLimit) throw new Error('Boosty returned an invalid page size');
            if (expectedTotal !== null && offset + payload.data.length > expectedTotal) {
                throw new Error('Boosty returned more subscribers than its reported total');
            }

            for (const subscriber of payload.data) {
                const id = subscriber?.id;
                if (id === undefined || id === null || String(id).trim() === '') {
                    throw new Error('Boosty returned a subscriber without an ID');
                }
                const normalizedId = String(id);
                if (seenIds.has(normalizedId)) throw new Error('Boosty repeated a subscriber page');
                seenIds.add(normalizedId);
                subscribers.push(subscriber);
            }

            offset += payload.data.length;
            if (expectedTotal !== null) {
                if (offset === expectedTotal) return subscribers;
                if (payload.data.length === 0) throw new Error('Boosty returned an incomplete subscriber list');
            } else {
                if (payload.data.length < requestedLimit) return subscribers;
                if (payload.data.length === 0) return subscribers;
            }
        }

        throw new Error('Boosty subscriber pagination exceeded the supported page limit');
    }

    async fetchSubscriberPage(limit, offset) {
        const params = new URLSearchParams({
            is_active: 'true',
            sort_by: 'on_time',
            limit: String(limit),
            offset: String(offset),
            order: 'gt',
        });
        const url = `https://api.boosty.to/v1/blog/nglzzz/subscribers?${params.toString()}`;
        let lastError;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const response = await this.request({
                    url,
                    method: 'GET',
                    timeout: 5000,
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                });
                if (!response || !response.data || typeof response.data !== 'object') {
                    throw new Error('Boosty returned an empty response');
                }
                return response.data;
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(lastError ? 'Boosty subscriber request failed' : 'Boosty returned an empty response');
    }

    async getSubscribers(limit) {
        try {
            const data = {};
            const subscribers = await this.getSubscriberRecords(limit);
            for (const subscriber of subscribers) {
                if (!subscriber?.name) continue;
                const name = String(subscriber.name).toLowerCase();
                data[name] = {
                    id: subscriber.id,
                    name: subscriber.name,
                    price: subscriber.price,
                    level: { name: Number(subscriber.price) === 0 ? 'Фоловер' : subscriber.level?.name || '' },
                    text: `${subscriber.name} - ${subscriber.level?.name || ''} (${subscriber.price})`,
                    subscribed: subscriber.subscribed,
                };
            }
            return data;
        } catch (error) {
            const diagnostic = error?.response?.status || error?.code || error?.name || 'unknown error';
            console.error('[Boosty] Failed to retrieve subscribers:', diagnostic);
            return {};
        }
    }

    async getPaidSubscribers(limit) {
        const subscribers = await this.getSubscribers(limit);

        if (!Object.keys(subscribers).length) {
            return {};
        }

        const data = {};
        for (let name in subscribers) {
            if (subscribers[name].price > 0 && subscribers[name].subscribed) {
                data[name] = subscribers[name];
            }
        }

        return data;
    }

    getTokenFromFile() {
        const filePath = path.join(global.APP_PATH || path.resolve(__dirname, '../../..'), 'storage', 'boosty-token');

        try {
            return fs.readFileSync(filePath, 'utf8').toString().trim();
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.error('[Boosty] Error reading token file:', e.code || e.message);
            }
            return null;
        }
    }
}

module.exports = BoostyClient;
