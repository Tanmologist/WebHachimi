// audioEngine.js —— 极简音效系统：Web Audio API + Audio 元素池
(function (global) {
  'use strict';

  // 音频实例池（按 url 缓存，避免重复创建）
  const _pool = Object.create(null);

  function getAudio(url) {
    if (!_pool[url]) _pool[url] = new Audio(url);
    return _pool[url];
  }

  const AudioEngine = {
    /**
     * 播放音效
     * @param {string} url       - 音频 URL 或 dataUrl
     * @param {number} [volume]  - 0~1，默认 1
     * @param {boolean} [loop]   - 是否循环，默认 false
     */
    play(url, volume, loop) {
      const audio = getAudio(url);
      audio.volume = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : 1;
      audio.loop   = Boolean(loop);
      audio.currentTime = 0;
      audio.play().catch(function () { /* 需要用户交互才能播放：静默失败 */ });
    },

    /** 停止指定音频 */
    stop(url) {
      const audio = _pool[url];
      if (audio) { audio.pause(); audio.currentTime = 0; }
    },

    /** 暂停指定音频 */
    pause(url) {
      const audio = _pool[url];
      if (audio) audio.pause();
    },

    /** 停止所有正在播放的音频 */
    stopAll() {
      Object.keys(_pool).forEach(function (url) {
        const a = _pool[url];
        a.pause();
        a.currentTime = 0;
      });
    },

    /** 设置指定音频音量 */
    setVolume(url, volume) {
      const audio = _pool[url];
      if (audio) audio.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    },

    /** 检查是否在播放 */
    isPlaying(url) {
      const audio = _pool[url];
      return audio ? !audio.paused : false;
    },
  };

  global.AudioEngine = AudioEngine;
})(window);
