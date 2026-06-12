const axios = require('axios');
const config = require('../config');

const VALID_STATUSES = new Set(['FULFILLED', 'CANCELED']);

/**
 * Update the status of a Channel Points redemption via Twitch Helix API.
 * When set to CANCELED, Twitch automatically refunds the user's channel points.
 *
 * @param {object} params
 * @param {string} params.broadcasterId - Twitch broadcaster user ID
 * @param {string} params.rewardId - Custom Reward ID
 * @param {string} params.redemptionId - Redemption ID
 * @param {'FULFILLED'|'CANCELED'} params.status - New redemption status
 */
async function updateRedemptionStatus({ broadcasterId, rewardId, redemptionId, status }) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid redemption status: ${status}`);
  }

  try {
    await axios.patch(
      'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions',
      { status },
      {
        params: {
          broadcaster_id: broadcasterId,
          reward_id: rewardId,
          id: redemptionId
        },
        headers: {
          'Client-Id': config.TWITCH_API_CLIENT_ID,
          'Authorization': 'Bearer ' + config.TWITCH_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`[Redemptions] Redemption ${redemptionId} updated to ${status}`);
  } catch (error) {
    if (error.response) {
      console.error(
        `[Redemptions] Failed to update redemption ${redemptionId} to ${status}:`,
        error.response.status,
        JSON.stringify(error.response.data)
      );
    } else {
      console.error(`[Redemptions] Failed to update redemption ${redemptionId} to ${status}:`, error.message);
    }
    throw error;
  }
}

/**
 * Fetch all custom rewards for the broadcaster from Twitch Helix API
 */
async function fetchAllRewards() {
  const rewards = [];
  let cursor = undefined;

  try {
    while (true) {
      const params = { broadcaster_id: config.BROADCASTER_ID };
      if (cursor) params.after = cursor;

      const response = await axios.get(
        'https://api.twitch.tv/helix/channel_points/custom_rewards',
        {
          params,
          headers: {
            'Client-Id': config.TWITCH_API_CLIENT_ID,
            'Authorization': 'Bearer ' + config.TWITCH_ACCESS_TOKEN
          }
        }
      );

      const data = response.data.data || [];
      rewards.push(...data);

      cursor = response.data.pagination?.cursor;
      if (!cursor || data.length === 0) break;
    }
  } catch (error) {
    if (error.response) {
      console.error('[Rewards] Failed to fetch rewards:', error.response.status, JSON.stringify(error.response.data));
    } else {
      console.error('[Rewards] Failed to fetch rewards:', error.message);
    }
  }

  return rewards;
}

/**
 * Create a single custom reward via Twitch Helix API
 */
async function createReward(rewardConfig) {
  try {
    const response = await axios.post(
      `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${config.BROADCASTER_ID}`,
      {
        title: rewardConfig.title,
        cost: rewardConfig.cost,
        prompt: rewardConfig.prompt || '',
        is_enabled: true,
        is_user_input_required: false,
        should_redemptions_skip_request_queue: false
      },
      {
        headers: {
          'Client-Id': config.TWITCH_API_CLIENT_ID,
          'Authorization': 'Bearer ' + config.TWITCH_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.data[0];
  } catch (error) {
    if (error.response) {
      const twitchError = error.response.data;
      if (twitchError.message === 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD') {
        console.error(`[Rewards] Cannot create "${rewardConfig.title}": a reward with this title already exists. Delete the old reward in Twitch dashboard first.`);
      } else {
        console.error(`[Rewards] Failed to create "${rewardConfig.title}":`, error.response.status, JSON.stringify(twitchError));
      }
    } else {
      console.error(`[Rewards] Failed to create "${rewardConfig.title}":`, error.message);
    }
    return null;
  }
}

/**
 * Ensure all required rewards exist. Checks by title in existing rewards,
 * creates missing ones. Returns a map of envVar → rewardId.
 *
 * @param {Array<{title: string, cost: number, prompt?: string, envVar: string}>} requiredRewards
 * @returns {Object<string, string>} map of envVar → rewardId
 */
async function ensureRewardsExist(requiredRewards) {
  const result = {};

  console.log('[Rewards] Checking custom rewards...');
  const existingRewards = await fetchAllRewards();

  for (const req of requiredRewards) {
    // Search by title in existing rewards
    const found = existingRewards.find(r => r.title === req.title);

    if (found) {
      console.log(`[Rewards] ✓ "${req.title}" found (ID: ${found.id})`);
      result[req.envVar] = found.id;
    } else {
      console.log(`[Rewards] "${req.title}" not found, creating...`);
      const created = await createReward(req);
      if (created) {
        console.log(`[Rewards] ✓ "${req.title}" created (ID: ${created.id})`);
        result[req.envVar] = created.id;
      } else {
        console.error(`[Rewards] ✗ Failed to set up "${req.title}". Create it manually or delete the old one.`);
        // Fall back to .env value if available
        result[req.envVar] = config[req.envVar] || null;
      }
    }
  }

  return result;
}

module.exports = { updateRedemptionStatus, ensureRewardsExist };
