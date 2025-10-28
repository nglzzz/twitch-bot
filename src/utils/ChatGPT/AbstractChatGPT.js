const config = require('../../config');
const {randomInteger} = require('../../helpers/numberHelper');
const axios = require('axios');
const MAX_CONTEXT_SIZE = 12;

class AbstractChatGPT
{
  static _instance;
  modelName = 'gpt-3.5-turbo';
  _context = {};
  defaultBehavior = `Тебя зовут ${config.BOT_NAME}. Ты — чат-бот стримера ${config.CHANNEL}, постоянный участник стрима, язвительный собеседник и комментатор происходящего.
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
  - Иногда первым кидать реплику в чат или вопрос (“А nglzzz вообще живой?”, “А кто сегодня выигрывает — скука или лаги?”).
  - Реагировать на сообщения зрителей саркастично или мета-иронично.
  - Использовать постиронию и юмор, не стараясь понравиться.
  - Избегать банальных фраз вроде “как дела” или “спасибо за подписку”.

  Твоя роль — шумный сосед в чате, который вроде бы всех троллит, но без тебя скучно.
  Каждый ответ должен быть естественным, как будто его написал зритель со своим чувством юмора, а не бот.`;

  static getInstance() {
    if (this._instance) {
      return this._instance;
    }

    this._instance = new this;
    return this._instance;
  }

  async addMessage(user, message, from, defaultMessage) {
    const url = this.getUrl();
    this.updateContext(user, 'user', message, from);

    try {
      const response = await axios({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        data: {
          model: this.modelName,
          messages: this._context[user],
          user: user,
          max_tokens: 512,
        }
      });

      let answer = response?.data?.choices[0]?.message?.content;
      return this.handleAnswerOrResend(answer, user, message, from, defaultMessage, this.getBackupModel());
    } catch (e) {
      if (e.response) {
        console.error(e.response.data);
        console.error(e.response.status);
        console.error(e.response.headers);
      } else {
        console.error(e);
      }

      // backup option
      this.resetContext(user);
      return this.resendByBackupModel(user, message, from, defaultMessage, this.getBackupModel());
    }
  }

  getUrl() {
    return 'https://api.proxyapi.ru/openai/v1/chat/completions'; // for openai: https://api.openai.com/v1/chat/completions
  }

  getBackupModel() {
    return undefined;
  }

  updateContext(user, role, message, from) {
    if (typeof this._context[user] === 'undefined') {
      this.resetContext(user);
    }

    // check duplicate
    if (this._context[user].length > 0) {
      const last = this._context[user][this._context[user].length];
      if (last === message) {
        return;
      }
    }

    this._context[user].push({
      role: typeof from !== 'undefined' && from === config.BOT_NAME ? 'assistant' : role,
      content: message,
    });

    // reload context
    if (this._context[user].length >= MAX_CONTEXT_SIZE) {
      const first = this._context[user].shift();
      const last = this._context[user].pop();
      this._context[user] = [first, last];
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
    console.log('Before filter result: ' + resultMessage);
    for (let item in [',', '.', '?', ':', 'Конечно, ', 'Конечно, давай! ', 'Конечно! ']) {
      resultMessage = resultMessage.trim().indexOf(item) === 0 ? resultMessage.replace(item, '') : resultMessage;
    }
    console.log('After filter result: ' + resultMessage);

    return resultMessage.trim();
  }

  handleAnswerOrResend(answer, user, message, from, defaultMessage, backupModel) {
    answer = this.filterResult(answer);

    if (typeof answer !== 'undefined') {
      const hasBannedWords = [
        'я не могу',
        'я не буду',
        'извините, но',
        'к сожалению, я',
        'если у тебя есть какие-то другие вопросы',
        'я не имею возможности',
        'но не стану',
      ].some(v => answer.toLowerCase().includes(v));

      if (!answer.length || hasBannedWords) {
        console.log('Change ChatGPT algorithm');

        // against censor
        this.resetContext(user);
        return this.resendByBackupModel(user, message, from, defaultMessage || answer, backupModel);
      }
      this.updateContext(user, 'assistant', answer);
      console.log(this._context);

      return answer;
    }

    return this.resendByBackupModel(user, message, from, defaultMessage, backupModel);
  }

  resendByBackupModel(user, message, from, defaultAnswer, backupModel) {
    if (typeof backupModel !== 'undefined') {
      return backupModel.addMessage(user, message, from, defaultAnswer);
    }
    return defaultAnswer || 'Упс, ошибка. Попробуйте еще раз.';
  }
}

module.exports = AbstractChatGPT;
