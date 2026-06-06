const axios = require('axios');
const config = require('../config');

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function getSpeechRequest(text, options = {}) {
  const pitch = clampNumber(options.pitch, -20, 20, 0);
  const speakingRate = clampNumber(options.rate, 0.25, 4, 1);
  const voiceName = options.voice || 'ru-RU-Standard-E';

  return {
    audioConfig: {
      audioEncoding: 'MP3',
      pitch: pitch,
      speakingRate: speakingRate,
    },
    input: {
      text: text,
    },
    voice: {
      languageCode: 'ru-RU',
      name: voiceName,
    },
  };
}

function synthesizeGoogleSpeech(text, options = {}) {
  const url = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

  const headers = {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.GOOGLE_SPEECH_API_TOKEN
    },
  };

  return axios
    .post(url, getSpeechRequest(text, options), headers)
    .then(response => ({
      ...response.data,
      playbackRate: 1,
      provider: 'google-cloud',
    }));
}

function synthesizeTranslateSpeech(text, options = {}) {
  return axios
    .get('https://translate.googleapis.com/translate_tts', {
      params: {
        ie: 'UTF-8',
        client: 'gtx',
        tl: 'ru',
        q: text,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      responseType: 'arraybuffer',
    })
    .then(response => ({
      audioContent: Buffer.from(response.data).toString('base64'),
      playbackRate: clampNumber(options.rate, 0.5, 2, 1),
      provider: 'google-translate',
    }));
}

function canFallbackToTranslate(error) {
  const status = error && error.response && error.response.status;
  return status === 401 || status === 403 || status === 429;
}

function synthesizeSpeech(text, options = {}) {
  return synthesizeGoogleSpeech(text, options)
    .catch(error => {
      if (!canFallbackToTranslate(error)) throw error;
      console.warn('Google Cloud TTS unavailable, using translate fallback:', error.response && error.response.status);
      return synthesizeTranslateSpeech(text, options);
    });
}

function useGoogleSpeech(callback, text, pitch) {
  synthesizeSpeech(text, { pitch: pitch })
    .then(data => callback(data))
    .catch(error => console.error(error));
}

module.exports = {
  useGoogleSpeech: useGoogleSpeech,
  synthesizeSpeech: synthesizeSpeech,
}
