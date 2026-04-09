const DEFAULT_MODEL = 'gpt-3.5-turbo';

const PROVIDERS = Object.freeze({
  openaiProxy: {
    type: 'chat',
    url: 'https://api.proxyapi.ru/openai/v1/chat/completions',
    apiKeyEnvNames: ['OPENAI_API_KEY'],
    maxTokens: 512,
  },
  deepseek: {
    type: 'chat',
    url: 'https://api.deepseek.com/chat/completions',
    apiKeyEnvNames: ['DEEPSEEK_API_KEY'],
    maxTokens: 512,
  },
  zai: {
    type: 'chat',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    apiKeyEnvNames: ['ZAI_API_KEY', 'GLM_API_KEY'],
    maxTokens: 4096,
    headers: {
      'HTTP-Referer': 'https://cline.bot',
      'X-Title': 'Cline',
      'X-Cline-Version': '1.1.52',
    },
    headerEnvNames: {
      'HTTP-Referer': 'ZAI_HTTP_REFERER',
      'X-Title': 'ZAI_TITLE',
      'X-Cline-Version': 'ZAI_CLIENT_VERSION',
    },
    payload: {
      temperature: 1.0,
      thinking: {
        type: 'enabled',
      },
    },
  },
  pawan: {
    type: 'chat',
    url: 'https://api.pawan.krd/v1/chat/completions',
    apiKeyEnvNames: ['PAWAN_API_KEY'],
    maxTokens: 512,
  },
  openaiCompletion: {
    type: 'completion',
    url: 'https://api.openai.com/v1/completions',
    apiKeyEnvNames: ['OPENAI_API_KEY'],
    maxTokens: 512,
  },
});

const MODEL_REGISTRY = Object.freeze({
  'deepseek-chat': {
    provider: 'deepseek',
    aliases: ['deepseek'],
    fallbackModels: ['gpt-4o-mini'],
  },
  'glm-5-turbo': {
    provider: 'zai',
    aliases: ['glm5turbo', 'glm5-turbo', 'glm_5_turbo'],
    fallbackModels: ['glm-5.1', 'gpt-4o-mini'],
  },
  'glm-5.1': {
    provider: 'zai',
    aliases: ['glm5.1', 'glm5-1', 'glm51'],
    fallbackModels: ['glm-5-turbo', 'gpt-4o-mini'],
  },
  'gpt-4o-mini': {
    provider: 'openaiProxy',
    fallbackModels: ['gpt-3.5-turbo-1106'],
  },
  'gpt-3.5-turbo-1106': {
    provider: 'openaiProxy',
    aliases: ['gpt-3.5'],
    fallbackModels: ['gpt-3.5-turbo'],
  },
  'gpt-3.5-turbo': {
    provider: 'openaiProxy',
    fallbackModels: ['gpt-4o'],
  },
  'gpt-4o': {
    provider: 'openaiProxy',
    fallbackModels: ['gpt-4-turbo'],
  },
  'gpt-4-turbo': {
    provider: 'openaiProxy',
    aliases: ['gpt-4.0-turbo'],
    fallbackModels: ['pawan'],
  },
  pawan: {
    provider: 'pawan',
    requestModel: 'pai-001',
    fallbackModels: ['text-davinci-003'],
  },
  'text-davinci-003': {
    provider: 'openaiCompletion',
    aliases: ['text-davinci'],
    fallbackModels: [],
  },
});

const MODEL_ALIASES = Object.entries(MODEL_REGISTRY).reduce((aliases, [modelName, modelConfig]) => {
  aliases[normalizeModelName(modelName)] = modelName;

  for (const alias of modelConfig.aliases || []) {
    aliases[normalizeModelName(alias)] = modelName;
  }

  return aliases;
}, {});

function normalizeModelName(modelName) {
  return String(modelName || '').trim().toLowerCase();
}

function resolveModelName(modelName) {
  return MODEL_ALIASES[normalizeModelName(modelName)] || DEFAULT_MODEL;
}

function getModelConfig(modelName) {
  return MODEL_REGISTRY[resolveModelName(modelName)];
}

function getProviderConfig(modelName) {
  const modelConfig = getModelConfig(modelName);

  return PROVIDERS[modelConfig.provider];
}

module.exports = {
  DEFAULT_MODEL,
  MODEL_REGISTRY,
  normalizeModelName,
  resolveModelName,
  getModelConfig,
  getProviderConfig,
};
