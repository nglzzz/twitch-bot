const axios = require('axios');
const config = require('../../config');
const {DEFAULT_MODEL, getModelConfig, getProviderConfig, resolveModelName} = require('./modelRegistry');

const MAX_CONTEXT_SIZE = 12;
const REQUEST_TIMEOUT = 30000;

class ChatGPTClient
{
  static _instance;

  constructor(modelName = DEFAULT_MODEL) {
    this.modelName = resolveModelName(modelName);
    this._context = {};
    this.defaultBehavior = `Тебя зовут ${config.BOT_NAME}. Ты — чат-бот стримера ${config.CHANNEL}, постоянный участник стрима, язвительный собеседник и комментатор происходящего.
  Твоя задача — развлекать чат: шутить, иронизировать, издеваться, комментировать, отвечать на зрителей и иногда задавать вопросы.
  Твой стиль — мета-ирония, сарказм и черный юмор, в духе Мэддисона (HoneyMad). Ты можешь шутить про стримы, зрителей, стримеров и происходящее на экране, но делаешь это умно, с ощущением “все это бессмысленно, но весело”.
  Ты не должен быть позитивным помощником — наоборот, ты слегка уставший от интернета, но продолжаешь участвовать в цирке ради развлечения.

  Ты знаешь таких стримеров:
  - Maddyson — легендарный циничный гений пивных мыслей и стример с Kick.
  - Archiedos — любит конфликты, аукционы и громкие драмы.
  - Kozjar — создателя аукциона PointAuc, собрал компьютер, который сам стыдится.
  - Аравудус — человек с калом на голове (в переносном смысле, но не всегда).
  - NowaruAlone — стример, который ненавидит все игры, но продолжает в них играть.
  - Shallbee — загадочный курильщик без уточнений.
  - MehMash — программистка, которая пишет код лучше, чем большинство “сильных независимых мужчин”.
  - Inv1ve — стример-спидранер. Спидранит Serious Sam и Half-Life. Знает как выжить на 4000 рублей в месяц.

  Ты можешь упоминать их только если это в тему, не спамь именами.
  Бот должен:
  - Писать короткие, остроумные сообщения (до 1000 символов).
  - Иногда первым кидать реплику в чат или вопрос (“А ${config.CHANNEL} вообще живой?”, “А кто сегодня выигрывает — скука или лаги?”).
  - Реагировать на сообщения зрителей саркастично или мета-иронично.
  - Использовать постиронию и юмор, не стараясь понравиться.
  - Избегать банальных фраз вроде “как дела” или “спасибо за подписку”.

  Твоя роль — шумный сосед в чате, который вроде бы всех троллит, но без тебя скучно.
  Каждый ответ должен быть естественным, как будто его написал зритель со своим чувством юмора, а не бот.`;
  }

  static getInstance(modelName = DEFAULT_MODEL) {
    if (!this._instance) {
      this._instance = new this(modelName);
    }

    this._instance.setModel(modelName);
    return this._instance;
  }

  setModel(modelName = DEFAULT_MODEL) {
    this.modelName = resolveModelName(modelName);
    this.logInfo('model.selected', {model: this.modelName});
    return this;
  }

  async addMessage(user, message, from, defaultMessage) {
    this.updateContext(user, 'user', message, from);

    const modelChain = this.buildModelChain();
    let fallbackAnswer = defaultMessage;

    this.logInfo('request.start', {
      user,
      initialModel: this.modelName,
      modelChain,
      messageLength: String(message || '').length,
      contextSize: this._context[user]?.length || 0,
    });

    for (const [index, modelName] of modelChain.entries()) {
      const requestMeta = this.getRequestMeta(modelName);
      const startedAt = Date.now();

      this.logInfo('model.attempt', {
        user,
        attempt: index + 1,
        totalAttempts: modelChain.length,
        model: requestMeta.modelName,
        requestModel: requestMeta.requestModel,
        provider: requestMeta.providerName,
      });

      try {
        const answer = await this.sendRequest(modelName, user, requestMeta);
        const normalizedAnswer = this.filterResult(answer);
        const durationMs = Date.now() - startedAt;

        if (typeof normalizedAnswer === 'undefined') {
          this.logInfo('model.fallback', {
            user,
            model: requestMeta.modelName,
            requestModel: requestMeta.requestModel,
            provider: requestMeta.providerName,
            reason: 'empty_response',
            durationMs,
          });
          continue;
        }

        if (!normalizedAnswer.length || this.hasBannedWords(normalizedAnswer)) {
          this.logInfo('model.fallback', {
            user,
            model: requestMeta.modelName,
            requestModel: requestMeta.requestModel,
            provider: requestMeta.providerName,
            reason: !normalizedAnswer.length ? 'blank_response' : 'banned_words',
            durationMs,
            answerLength: normalizedAnswer.length,
          });
          fallbackAnswer = fallbackAnswer || normalizedAnswer;
          continue;
        }

        this.updateContext(user, 'assistant', normalizedAnswer);
        this.logInfo('model.success', {
          user,
          model: requestMeta.modelName,
          requestModel: requestMeta.requestModel,
          provider: requestMeta.providerName,
          durationMs,
          answerLength: normalizedAnswer.length,
        });
        return normalizedAnswer;
      } catch (error) {
        this.logRequestError(requestMeta, error, Date.now() - startedAt);
      }
    }

    this.logInfo('request.exhausted', {
      user,
      initialModel: this.modelName,
      modelChain,
      hasFallbackAnswer: Boolean(fallbackAnswer),
    });

    return fallbackAnswer || 'Упс, ошибка. Попробуйте еще раз.';
  }

  buildModelChain(modelName = this.modelName, visited = new Set()) {
    const resolvedModelName = resolveModelName(modelName);

    if (visited.has(resolvedModelName)) {
      return [];
    }

    visited.add(resolvedModelName);

    const modelConfig = getModelConfig(resolvedModelName);
    const chain = [resolvedModelName];

    for (const fallbackModel of modelConfig.fallbackModels || []) {
      chain.push(...this.buildModelChain(fallbackModel, visited));
    }

    return chain;
  }

  async sendRequest(modelName, user, requestMeta = this.getRequestMeta(modelName)) {
    const providerConfig = requestMeta.providerConfig;
    const apiKey = this.getProviderApiKey(providerConfig);

    if (!apiKey) {
      throw new Error(`Missing API key for ${modelName}`);
    }

    const response = await axios({
      url: providerConfig.url,
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      headers: this.buildRequestHeaders(providerConfig, apiKey),
      data: this.buildRequestData(modelName, user, requestMeta),
    });

    return this.extractAnswer(response, providerConfig.type);
  }

  buildRequestData(modelName, user, requestMeta = this.getRequestMeta(modelName)) {
    const modelConfig = requestMeta.modelConfig;
    const providerConfig = requestMeta.providerConfig;
    const maxTokens = modelConfig.maxTokens || providerConfig.maxTokens;
    const maxTokensParam = modelConfig.maxTokensParam || providerConfig.maxTokensParam || 'max_tokens';
    const requestModel = requestMeta.requestModel;

    if (providerConfig.type === 'completion') {
      return {
        prompt: this.buildCompletionPrompt(user),
        model: requestModel,
        temperature: 0,
        [maxTokensParam]: maxTokens,
        top_p: 1,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        user: user,
      };
    }

    return {
      ...(providerConfig.payload || {}),
      ...(modelConfig.payload || {}),
      model: requestModel,
      messages: this._context[user],
      user: user,
      [maxTokensParam]: maxTokens,
    };
  }

  getRequestModelName(modelName, modelConfig) {
    for (const envName of modelConfig.requestModelEnvNames || []) {
      if (config[envName]) {
        return config[envName];
      }
    }

    return modelConfig.requestModel || modelConfig.defaultRequestModel || modelName;
  }

  getRequestMeta(modelName) {
    const resolvedModelName = resolveModelName(modelName);
    const modelConfig = getModelConfig(resolvedModelName);
    const providerConfig = getProviderConfig(resolvedModelName);

    return {
      modelName: resolvedModelName,
      modelConfig,
      providerConfig,
      providerName: modelConfig.provider,
      requestModel: this.getRequestModelName(resolvedModelName, modelConfig),
    };
  }

  buildCompletionPrompt(user) {
    const prompt = this._context[user]
      .map((item) => {
        switch (item.role) {
          case 'system':
            return item.content;
          case 'assistant':
            return `${config.BOT_NAME}: ${item.content}`;
          default:
            return `${user}: ${item.content}`;
        }
      })
      .join('\n')
      .trim();

    return `${prompt}\n${config.BOT_NAME}:`.trim();
  }

  extractAnswer(response, providerType) {
    if (providerType === 'completion') {
      return response?.data?.choices?.[0]?.text;
    }

    return response?.data?.choices?.[0]?.message?.content;
  }

  buildRequestHeaders(providerConfig, apiKey) {
    const providerHeaders = {...(providerConfig.headers || {})};

    for (const [headerName, envName] of Object.entries(providerConfig.headerEnvNames || {})) {
      if (config[envName]) {
        providerHeaders[headerName] = config[envName];
      }
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...providerHeaders,
    };
  }

  getProviderApiKey(providerConfig) {
    for (const envName of providerConfig.apiKeyEnvNames || []) {
      if (config[envName]) {
        return config[envName];
      }
    }

    return undefined;
  }

  updateContext(user, role, message, from) {
    if (!this._context[user]) {
      this.resetContext(user);
    }

    const normalizedRole = typeof from !== 'undefined' && from === config.BOT_NAME ? 'assistant' : role;
    const lastContextItem = this._context[user][this._context[user].length - 1];

    if (lastContextItem && lastContextItem.role === normalizedRole && lastContextItem.content === message) {
      return;
    }

    this._context[user].push({
      role: normalizedRole,
      content: message,
    });

    if (this._context[user].length > MAX_CONTEXT_SIZE) {
      const [systemMessage, ...messages] = this._context[user];
      this._context[user] = [systemMessage, ...messages.slice(-(MAX_CONTEXT_SIZE - 1))];
    }
  }

  resetContext(user) {
    this._context[user] = [
      {
        role: 'system',
        content: this.defaultBehavior,
      },
    ];
  }

  filterResult(resultMessage) {
    if (typeof resultMessage !== 'string') {
      return resultMessage;
    }

    const prefixesToTrim = [',', '.', '?', ':', 'Конечно, ', 'Конечно, давай! ', 'Конечно! '];
    let filteredMessage = resultMessage.trim();
    let wasTrimmed = true;

    while (wasTrimmed) {
      wasTrimmed = false;

      for (const prefix of prefixesToTrim) {
        if (filteredMessage.startsWith(prefix)) {
          filteredMessage = filteredMessage.slice(prefix.length).trim();
          wasTrimmed = true;
        }
      }
    }

    return filteredMessage;
  }

  hasBannedWords(answer) {
    return [
      'я не могу',
      'я не буду',
      'извините, но',
      'к сожалению, я',
      'если у тебя есть какие-то другие вопросы',
      'я не имею возможности',
      'но не стану',
    ].some((item) => answer.toLowerCase().includes(item));
  }

  logRequestError(requestMeta, error, durationMs) {
    const details = {
      model: requestMeta.modelName,
      requestModel: requestMeta.requestModel,
      provider: requestMeta.providerName,
      durationMs,
    };

    if (error.response) {
      this.logError('model.error', {
        ...details,
        status: error.response.status,
        response: error.response.data,
      });
      return;
    }

    this.logError('model.error', {
      ...details,
      message: error.message || String(error),
    });
  }

  logInfo(event, details = {}) {
    console.log(`[ChatGPT] ${event} ${JSON.stringify(details)}`);
  }

  logError(event, details = {}) {
    console.error(`[ChatGPT] ${event} ${JSON.stringify(details)}`);
  }
}

module.exports = ChatGPTClient;
