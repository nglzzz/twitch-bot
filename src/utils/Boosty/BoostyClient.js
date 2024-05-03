const axios = require('axios');
const fs = require('fs');
const path = require('path');

class BoostyClient
{
    constructor(apiKey) {
        this.apiKey = (apiKey || this.getTokenFromFile()).trim();
    }

    async getSubscribers(limit) {
        limit = 100 || limit;
        const url = `https://api.boosty.to/v1/blog/nglzzz/subscribers?sort_by=on_time&limit=${limit}&order=gt`;

        if (!this.apiKey) {
            console.log('Boosty API key not found');
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
                        name: subscriber.name,
                        price: subscriber.price,
                        level: {
                            name: subscriber.price === 0 ? 'Фоловер' : subscriber.level.name,
                        },
                        text: `${subscriber.name} - ${subscriber.level.name} (${subscriber.price})`,
                    };
                }
            } while(response?.total && response.total > total)

            return data;
        } catch (e) {
            if (e.response) {
                console.error(e.response.data);
                console.error(e.response.status);
                console.error(e.response.headers);
            } else {
                console.error(e);
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
            if (subscribers[name].price > 0) {
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
