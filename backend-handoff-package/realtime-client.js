(function () {
  'use strict';

  if (typeof window.DANDAN_REALTIME_ENABLED === 'undefined') window.DANDAN_REALTIME_ENABLED = true;

  var socket = null;
  var accessToken = null;
  var reconnectTimer = null;
  var reconnectAttempts = 0;
  var manuallyDisconnected = false;
  var fallbackReported = false;
  var subscribers = new Set();
  var MAX_RECONNECT_ATTEMPTS = 5;

  function websocketUrl(token) {
    var apiOrigin = window.DANDAN_API_ORIGIN || '/dd';
    var base;
    if (/^https?:\/\//i.test(apiOrigin)) {
      base = apiOrigin.replace(/^http/i, 'ws').replace(/\/$/, '');
    } else {
      base = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + ('/' + apiOrigin).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    }
    return base + '/api/realtime?token=' + encodeURIComponent(token);
  }

  function reportFallback() {
    if (fallbackReported) return;
    fallbackReported = true;
    window.console.warn('实时连接暂不可用，已切换为接口刷新');
    window.dispatchEvent(new CustomEvent('dandan:realtime-fallback', { detail: { attempts: reconnectAttempts } }));
  }

  function scheduleReconnect() {
    if (manuallyDisconnected || !accessToken || window.DANDAN_REALTIME_ENABLED === false) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      reportFallback();
      return;
    }
    var delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
    reconnectAttempts += 1;
    reconnectTimer = window.setTimeout(openSocket, delay);
  }

  function dispatchMessage(message) {
    subscribers.forEach(function (subscriber) {
      if (subscriber.types.has('*') || subscriber.types.has(message.type)) {
        try { subscriber.handler(message); } catch (_) { /* one subscriber cannot break the connection */ }
      }
    });
  }

  function openSocket() {
    if (manuallyDisconnected || !accessToken || window.DANDAN_REALTIME_ENABLED === false) return;
    var current = new window.WebSocket(websocketUrl(accessToken));
    socket = current;
    current.onopen = function () {
      if (socket !== current) return;
      reconnectAttempts = 0;
      fallbackReported = false;
    };
    current.onmessage = function (event) {
      try {
        var message = JSON.parse(event.data);
        if (message && typeof message.type === 'string') dispatchMessage(message);
      } catch (_) { /* ignore malformed server frames */ }
    };
    current.onerror = function () { /* close drives the bounded retry path */ };
    current.onclose = function () {
      if (socket === current) socket = null;
      scheduleReconnect();
    };
  }

  window.DandanRealtime = {
    connect: function (token) {
      if (window.DANDAN_REALTIME_ENABLED === false || !token || !window.WebSocket) return false;
      accessToken = String(token);
      manuallyDisconnected = false;
      reconnectAttempts = 0;
      fallbackReported = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      openSocket();
      return true;
    },
    subscribe: function (eventTypes, handler) {
      var types = new Set(Array.isArray(eventTypes) ? eventTypes : [eventTypes]);
      var subscriber = { types: types, handler: handler };
      subscribers.add(subscriber);
      return function () { subscribers.delete(subscriber); };
    },
    disconnect: function () {
      manuallyDisconnected = true;
      accessToken = null;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (socket) {
        var current = socket;
        socket = null;
        current.onclose = null;
        current.close();
      }
    }
  };
}());
