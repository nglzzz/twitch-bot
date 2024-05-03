const axios = require('axios');
const config = require(SRC_PATH + '/config');

class PointAucClient
{
    constructor(apiKey) {
        this.apiKey = (apiKey || config.POINTAUC_TOKEN).trim();
    }

    async makeBid(cost, user, message) {
        try {
            await axios({
                url: 'https://pointauc.com/api/oshino/bids',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                data: {
                    bids: [{
                        cost: cost,
                        username: user,
                        message: message,
                        color: '#f65d32',
                        insertStrategy: 'none',
                    }]
                }
            });

            return true;
        } catch (e) {
            console.error(e);

            return false;
        }
    }
}

module.exports = PointAucClient;