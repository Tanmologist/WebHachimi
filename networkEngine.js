// networkEngine.js —— WebSocket 广播客户端（多人/联机游戏基础）
// 连接到 ws://localhost:5577/ws，发送/接收 JSON 消息，广播给所有其他客户端
(function (global) {
  'use strict';

  const DEFAULT_WS_URL = 'ws://' + location.host;

  let _ws   = null;
  let _listeners = [];
  let _openCbs   = [];
  let _reconnectTimer = null;
  let _shouldReconnect = false;
  let _url = DEFAULT_WS_URL;

  function _connect() {
    try {
      _ws = new WebSocket(_url);
    } catch (e) {
      console.warn('[NetworkEngine] 无法创建 WebSocket：', e.message);
      return;
    }
    _ws.onopen = function () {
      console.info('[NetworkEngine] 已连接到', _url);
      _openCbs.forEach(function (cb) { try { cb(); } catch (e) {} });
    };
    _ws.onmessage = function (ev) {
      let data;
      try { data = JSON.parse(ev.data); } catch (e) { data = ev.data; }
      _listeners.forEach(function (fn) { try { fn(data); } catch (e) {} });
    };
    _ws.onerror = function (e) {
      console.warn('[NetworkEngine] 连接错误', e);
    };
    _ws.onclose = function () {
      console.info('[NetworkEngine] 连接断开');
      _ws = null;
      if (_shouldReconnect) {
        _reconnectTimer = setTimeout(_connect, 2000);
      }
    };
  }

  const NetworkEngine = {
    /**
     * 连接到 WebSocket 服务器
     * @param {string} [wsUrl]   - 可选，默认 ws://localhost:PORT
     * @param {boolean} [autoReconnect] - 断线自动重连，默认 true
     */
    connect(wsUrl, autoReconnect) {
      if (_ws) return;
      _url = wsUrl || DEFAULT_WS_URL;
      _shouldReconnect = autoReconnect !== false;
      _connect();
    },

    /** 断开连接 */
    disconnect() {
      _shouldReconnect = false;
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
      if (_ws) { _ws.close(); _ws = null; }
    },

    /** 发送消息（自动序列化 JSON） */
    send(data) {
      if (!_ws || _ws.readyState !== WebSocket.OPEN) {
        console.warn('[NetworkEngine] 未连接，无法发送');
        return false;
      }
      _ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    },

    /**
     * 发送结构化游戏消息
     * @param {string} type     - 消息类型（如 'player-move', 'chat', 'action'）
     * @param {*} payload       - 消息数据
     */
    broadcast(type, payload) {
      return this.send({ type, payload, ts: Date.now() });
    },

    /** 注册消息监听器 */
    onMessage(cb) {
      _listeners.push(cb);
      return function () { _listeners = _listeners.filter(function (f) { return f !== cb; }); };
    },

    /** 连接成功回调 */
    onOpen(cb) { _openCbs.push(cb); },

    /** 检查是否已连接 */
    isConnected() { return _ws !== null && _ws.readyState === WebSocket.OPEN; },

    get readyState() { return _ws ? _ws.readyState : WebSocket.CLOSED; },
  };

  global.NetworkEngine = NetworkEngine;
})(window);
