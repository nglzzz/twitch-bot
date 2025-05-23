const axios = require('axios');
const fs = require('fs');
const path = require('path');

class BoostyClient
{
    MAX_ATTEMPTS = 3;
    attempts = 0;

    constructor(apiKey) {
        this.apiKey = (apiKey || this.getTokenFromFile()).trim();
    }

    async getSubscribers(limit) {
        limit = 100 || limit;
        const url = `https://api.boosty.to/v1/blog/nglzzz/subscribers?is_active=true&sort_by=on_time&limit=${limit}&order=gt`;

        if (!this.apiKey) {
            console.log('Boosty API key not found');
            return {};
        }

        this.attempts++;
        if (this.attempts > this.MAX_ATTEMPTS) {
            console.error('Failed to retrieve subscribers after multiple attempts. Skipping.');
            this.attempts = 0;
            return {};
        }

        try {
            let data = {};
            let response;
            let total = 0;

            do {
                response = (await axios({
                    url: url,
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                })).data;

                total += response?.data?.length;

                for (const subscriber of response?.data) {
                    data[subscriber.name.toLowerCase()] = {
                        id: subscriber.id,
                        name: subscriber.name,
                        price: subscriber.price,
                        level: {
                            name: subscriber.price === 0 ? 'Фоловер' : subscriber.level.name,
                        },
                        text: `${subscriber.name} - ${subscriber.level.name} (${subscriber.price})`,
                        subscribed: subscriber.subscribed
                    };
                }
            } while(response?.total && response.total > total)

            this.attempts = 0;

            return data;
        } catch (e) {
            if (e.response) {
                console.error(e.response.data);
                console.error(e.response.status);
                console.error(e.response.headers);
            } else {
                console.error(e);
            }

            if (this.attempts < this.MAX_ATTEMPTS) {
                return this.getSubscribers(limit);
            }

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
        const filePath = path.join(APP_PATH, 'storage', 'boosty-token');

        try {
            return fs.readFileSync(filePath, 'utf8').toString();
        } catch (e) {
            console.error(e);
            return null;
        }
    }
}

module.exports = BoostyClient;
