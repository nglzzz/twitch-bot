/* ============ Yandex Games SDK wrapper ============
   В релизе ничего менять не нужно: на площадке SDK подхватится сам,
   реклама и сейвы заработают автоматически. Локально — заглушки.

   Что используется (по официальной документации):
   • YaGames.init()                          — инициализация
   • ysdk.features.LoadingAPI.ready()        — «игра загружена»
   • ysdk.adv.showRewardedVideo({callbacks}) — реклама за награду (магазин, монеты)
   • ysdk.adv.showFullscreenAdv({callbacks}) — межстраничная (при смене дня)
   • ysdk.adv.getBannerAdvStatus()/showBannerAdv()/hideBannerAdv() — sticky banner
   • player.setData/getData                  — облачные сохранения */
'use strict';

const YSDK = {
  ysdk: null,
  player: null,
  available: false,

  // onPlatform=true, только когда SDK предоставлен самой площадкой —
  // тогда работает настоящая реклама. Если скрипт подгружен локально
  // (для отладки сейвов), реклама показывается заглушкой.
  onPlatform: false,

  init() {
    return new Promise((resolve) => {
      if (typeof YaGames !== 'undefined') {
        this.onPlatform = true;
        this._initReal().finally(() => resolve(this));
      } else {
        const s = document.createElement('script');
        s.src = 'https://yandex.ru/games/sdk/v2';
        s.onload = () => this._initReal().finally(() => resolve(this));
        s.onerror = () => { console.info('[YSDK] SDK недоступен, режим заглушки'); resolve(this); };
        document.head.appendChild(s);
      }
    });
  },

  async _initReal() {
    try {
      this.ysdk = await YaGames.init();
      this.available = true;
      try { this.player = await this.ysdk.getPlayer({ scopes: false }); } catch (e) {}
      try { this.ysdk.features.LoadingAPI && this.ysdk.features.LoadingAPI.ready(); } catch (e) {}
      console.info('[YSDK] подключён, onPlatform =', this.onPlatform);
    } catch (e) {
      console.info('[YSDK] ошибка инициализации, работаем локально', e);
    }
  },

  /* ----- Реклама -----
     Документация: onClose срабатывает и при ошибке/дисклейме частых вызовов,
     поэтому награду выдаём ТОЛЬКО в onRewarded, а onClose — для пост-действий. */

  // Рекламируемая награда. onSuccess вызывается только если награда засчитана.
  showRewarded(onSuccess, onClose) {
    if (this.onPlatform && this.ysdk.adv) {
      let rewarded = false;
      const cb = {
        onOpen: () => { Game.audioMute(true); },
        onRewarded: () => { rewarded = true; if (onSuccess) onSuccess(); },
        onClose: (wasShown) => {
          Game.audioMute(false);
          if (onClose) onClose(rewarded);
        },
        onError: () => { Game.audioMute(false); if (onClose) onClose(false); }
      };
      // поддерживаем оба формата вызова из документации:
      // { callbacks: {...} } и { onOpen, onRewarded, ... }
      this.ysdk.adv.showRewardedVideo(Object.assign({ callbacks: cb }, cb));
    } else {
      this._stubAd().then((ok) => { if (ok) onSuccess(); if (onClose) onClose(ok); });
    }
  },

  // Межстраничная реклама (между днями). Вне Яндекса — ничего не делает.
  showInterstitial() {
    if (this.onPlatform && this.ysdk.adv) {
      try {
        const cb = {
          onOpen: () => Game.audioMute(true),
          onClose: (wasShown) => Game.audioMute(false),
          onError: () => Game.audioMute(false)
        };
        this.ysdk.adv.showFullscreenAdv(Object.assign({ callbacks: cb }, cb));
      } catch (e) {}
    } else {
      // локально показываем видимую «рекламную паузу» с таймером
      UI.showAdStub('РЕКЛАМНАЯ ПАУЗА');
    }
  },

  /* ----- Sticky banner (нужно включить в Консоли разработчика → Реклама) ----- */

  async showBanner() {
    if (!this.onPlatform || !this.ysdk.adv) return false;
    try {
      const r = await this.ysdk.adv.showBannerAdv();
      return !!(r && r.stickyAdvIsShowing);
    } catch (e) { return false; }
  },

  async hideBanner() {
    if (!this.available || !this.ysdk.adv) return;
    try { await this.ysdk.adv.hideBannerAdv(); } catch (e) {}
  },

  _stubAd() {
    return new Promise((resolve) => UI.showAdStub().then(resolve));
  },

  /* ----- Сохранения ----- */

  async cloudSave(data) {
    if (this.player) {
      try { await this.player.setData({ save: data }, true); } catch (e) {}
    }
  },

  async cloudLoad() {
    if (this.player) {
      try {
        const d = await this.player.getData(['save']);
        if (d && d.save) return d.save;
      } catch (e) {}
    }
    return null;
  },

  gameplayStart() { try { this.ysdk.features.GameplayAPI.start(); } catch (e) {} },
  gameplayStop()  { try { this.ysdk.features.GameplayAPI.stop(); } catch (e) {} }
};
