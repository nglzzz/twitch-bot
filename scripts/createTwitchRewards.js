/**
 * Script to create Twitch Channel Points custom rewards via Helix API.
 * Rewards must be created by the same Client-Id that will later update
 * their redemption status (FULFILLED / CANCELED).
 *
 * Usage:
 *   node scripts/createTwitchRewards.js
 *
 * After running, update the new reward IDs in your .env file:
 *   TWITCH_REWARD_BURN_MEMER_ID=...
 *   TWITCH_REWARD_RANDOM_MEME_ID=...
 *   TWITCH_REWARD_RANDOM_AUDIO_MEME_ID=...
 *
 * Then disable/delete the OLD rewards in your Twitch dashboard manually.
 */

const path = require('path');
global.APP_PATH = path.dirname(__dirname);
global.SRC_PATH = path.join(APP_PATH, 'src');

const config = require('../src/config');
const axios = require('axios');
const { getTwitchAccessToken } = require('../src/services/token.service');

const BROADCASTER_ID = config.BROADCASTER_ID;
const CLIENT_ID = config.TWITCH_API_CLIENT_ID;
let ACCESS_TOKEN;

const REWARDS = [
  {
    title: 'Спалить мемера',
    cost: 100,
    prompt: 'Узнать кто прислал последний мем',
    envVar: 'TWITCH_REWARD_BURN_MEMER_ID'
  },
  {
    title: 'Случайный мем',
    cost: 100,
    prompt: 'Отправляет случайный мем через MemeAlerts',
    envVar: 'TWITCH_REWARD_RANDOM_MEME_ID'
  },
  {
    title: 'Случайный аудио-мем',
    cost: 100,
    prompt: 'Отправляет случайный аудио-мем через MemeAlerts',
    envVar: 'TWITCH_REWARD_RANDOM_AUDIO_MEME_ID'
  }
];

async function createReward(rewardConfig) {
  try {
    const response = await axios.post(
      `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${BROADCASTER_ID}`,
      {
        title: rewardConfig.title,
        cost: rewardConfig.cost,
        prompt: rewardConfig.prompt,
        is_enabled: true,
        is_user_input_required: false,
        should_redemptions_skip_request_queue: false
      },
      {
        headers: {
          'Client-Id': CLIENT_ID,
          'Authorization': 'Bearer ' + ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const reward = response.data.data[0];
    console.log(`✅ Created "${rewardConfig.title}" → ID: ${reward.id}`);
    console.log(`   ${rewardConfig.envVar}=${reward.id}`);
    return reward.id;
  } catch (error) {
    if (error.response) {
      console.error(`❌ Failed to create "${rewardConfig.title}":`, error.response.status, JSON.stringify(error.response.data));
    } else {
      console.error(`❌ Failed to create "${rewardConfig.title}":`, error.message);
    }
    return null;
  }
}

async function main() {
  ACCESS_TOKEN = await getTwitchAccessToken();

  if (!BROADCASTER_ID || !CLIENT_ID || !ACCESS_TOKEN) {
    console.error('Missing required configuration: BROADCASTER_ID, TWITCH_API_CLIENT_ID, or Twitch access token');
    process.exitCode = 1;
    return;
  }

  console.log('Creating Twitch Channel Points rewards...');
  console.log(`Broadcaster ID: ${BROADCASTER_ID}`);
  console.log(`Client ID: ${CLIENT_ID}`);
  console.log('');

  console.log('⚠️  IMPORTANT: Change the "cost" values in this script if needed before running!');
  console.log('');

  for (const rewardConfig of REWARDS) {
    await createReward(rewardConfig);
  }

  console.log('');
  console.log('Done! Copy the new IDs to your .env file.');
  console.log('Then disable/delete the OLD rewards in your Twitch dashboard.');
}

main().catch((error) => {
  console.error('Failed to create Twitch rewards:', error.message);
  process.exitCode = 1;
});
