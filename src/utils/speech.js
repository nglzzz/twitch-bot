const axios = require('axios');
const config = require('../config');

function useGoogleSpeech(callback, text, pitch) {
  const url = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

  const data = {
    'audioConfig': {
      'audioEncoding': 'LINEAR16',
      'pitch': pitch || 0,
      'speakingRate': 1
    },
    'input': {
      'text': text
    },
    'voice': {
      'languageCode': 'ru-RU',
      'name': 'ru-RU-Standard-E'
    }
  };

  const headers = {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.GOOGLE_SPEECH_API_TOKEN
    }
  };

  axios
    .post(url, data, headers)
    .then(response => callback(response.data))
    .catch(error => console.error(error));
}

module.exports = {
  useGoogleSpeech: useGoogleSpeech,
}
