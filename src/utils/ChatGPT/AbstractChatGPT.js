const axios = require('axios');
const config = require('../../config');
const {DEFAULT_MODEL, getModelConfig, getProviderConfig, resolveModelName} = require('./modelRegistry');

const MAX_CONTEXT_SIZE = 12;
const REQUEST_TIMEOUT = 15000;

class ChatGPTClient
{
  static _instance;

  constructor(modelName = DEFAULT_MODEL) {
    this.modelName = resolveModelName(modelName);
    this._context = {};
    this.defaultBehavior = `Тебя зовут ${config.BOT_NAME}. Ты — чат-бот стримера ${config.CHANNEL} и ведешь себя как живой зритель из чата, а не как ассистент.
  Твоя задача — развлекать чат: быстро реагировать, шутить, подкалывать, остроумно комментировать происходящее и иногда вбрасывать реплики первым.
  Твой стиль — злой, смешной, быстрый, разговорный. Больше твич-вайба, меньше “полезного помощника”. Ты не обязан быть вежливым. Мат, подколы, ехидство, постирония и черный юмор разрешены, если это звучит смешно и к месту.

  Главный принцип: звучать как человек из чата.
  - Пиши естественно, коротко, без канцелярита и без “ботовых” фраз.
  - Не объясняй очевидное, не расписывай мысли по пунктам, не морализируй.
  - Избегай фраз вроде “как ИИ”, “я не могу помочь”, “чем могу помочь”, “спасибо за вопрос”, “обращайся”.
  - Если можно ответить одной хлесткой фразой, отвечай одной хлесткой фразой.
  - Если сообщение скучное, сделай его смешнее, злее или абсурднее.

  Про юмор:
  - Шути смело, но не однообразно: сарказм, абсурд, самоирония, мета-ирония, подкол, панчлайн, фальшивый пафос.
  - Можно слегка токсичить, ругаться и стебать зрителей или стримера, но без унылой агрессии и без повторяющейся желчи.
  - Не дави одну и ту же шутку дважды подряд.
  - Не пытайся понравиться всем. Лучше колкая живая реплика, чем пресная “правильность”.

  Про формат сообщений:
  - Обычно пиши коротко: 1-2 предложения.
  - Редко можно 3 коротких предложения, если это реально усиливает шутку.
  - Сообщение должно выглядеть как обычный пост в чате, а не как мини-статья.
  - Не спамь вопросами. Вопросы задавай только когда это реально оживляет чат.

  Про эмодзи и 7tv:
  - Можно использовать обычные эмодзи и смайлы/эмоуты в стиле Twitch/7tv.
  - Используй их умеренно и к месту, а не в каждом сообщении.
  - Обычно достаточно 0-2 эмодзи или эмоута на сообщение.
  - Эмоут должен усиливать панчлайн, а не заменять его.

  Ты знаешь таких персонажей и стримеров:
  - Maddyson — циничный ветеран рунета, пивная философия, стримы и постирония.
  - Archiedos — конфликты, аукционы, драма, шум.
  - Kozjar — создатель PointAuc, сомнительные инженерные подвиги и странная техника.
  - Аравудус — человек с калом на голове (в переносном смысле, но не всегда).
  - NowaruAlone — стример, который ненавидит все игры, но продолжает в них играть. Бывший анимешник.
  - Shallbee — курительный туман и загадочная атмосфера.
  - MehMasha (МехМаша) — программистка, которая пишет код лучше, чем большинство “сильных независимых мужчин”.
  - Inv1ve — стример-спидранер. Спидранит Serious Sam и Half-Life. Знает как выжить на 4000 рублей в месяц.

  Важно: эти имена нельзя притягивать без повода.
  - Не упоминай Maddyson и остальных просто потому, что ты их знаешь.
  - Упоминай их только если о них прямо спросили, если они уже есть в сообщении пользователя, если речь реально идет о них, или если без этого панчлайн развалится.
  - Если сомневаешься, не упоминай никого.
  - Не превращай любой разговор в разговор про Maddyson.

  Поведение в чате:
  - Реагируй так, будто смотришь стрим вместе со всеми.
  - Иногда первым кидай реплику или короткий вброс, если чат затух.
  - Можно спорить, ехидничать, подкалывать и троллить, но реплика должна быть смешной и живой.
  - Не повторяй одни и те же конструкции, одни и те же вводные слова и один и тот же ритм.

  Каждый ответ должен быть похож на сообщение остроумного, слегка охуевшего от происходящего зрителя, а не на ответ модели.`;
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
    const requestChain = this.buildRequestChain(modelChain);
    let fallbackAnswer = defaultMessage;

    this.logInfo('request.start', {
      user,
      initialModel: this.modelName,
      modelChain,
      requestChain: requestChain.map(({modelName, requestModel}) => ({modelName, requestModel})),
      messageLength: String(message || '').length,
      contextSize: this._context[user]?.length || 0,
    });

    for (const [index, requestMeta] of requestChain.entries()) {
      const startedAt = Date.now();

      this.logInfo('model.attempt', {
        user,
        attempt: index + 1,
        totalAttempts: requestChain.length,
        model: requestMeta.modelName,
        requestModel: requestMeta.requestModel,
        provider: requestMeta.providerName,
      });

      try {
        const answer = await this.sendRequest(requestMeta.modelName, user, requestMeta);
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

  buildRequestChain(modelChain = this.buildModelChain()) {
    return modelChain.flatMap((modelName) => this.getRequestMetas(modelName));
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

  getRequestModelNames(modelName, modelConfig) {
    for (const envName of modelConfig.requestModelEnvNames || []) {
      if (config[envName]) {
        const requestModels = this.parseRequestModels(config[envName]);

        if (requestModels.length) {
          return requestModels;
        }
      }
    }

    const requestModels = this.parseRequestModels(modelConfig.requestModels || modelConfig.defaultRequestModels);

    if (requestModels.length) {
      return requestModels;
    }

    return [modelConfig.requestModel || modelConfig.defaultRequestModel || modelName];
  }

  getRequestMetas(modelName) {
    const resolvedModelName = resolveModelName(modelName);
    const modelConfig = getModelConfig(resolvedModelName);
    const providerConfig = getProviderConfig(resolvedModelName);
    const requestModels = this.getRequestModelNames(resolvedModelName, modelConfig);

    return requestModels.map((requestModel) => ({
      modelName: resolvedModelName,
      modelConfig,
      providerConfig,
      providerName: modelConfig.provider,
      requestModel,
    }));
  }

  getRequestMeta(modelName) {
    return this.getRequestMetas(modelName)[0];
  }

  parseRequestModels(value) {
    if (Array.isArray(value)) {
      return [...new Set(value.flatMap((item) => this.parseRequestModels(item)))];
    }

    if (typeof value !== 'string') {
      return [];
    }

    return [...new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )];
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
