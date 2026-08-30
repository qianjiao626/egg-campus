(function () {
  'use strict';

  var isLocalPreview = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  var base = window.DANDAN_API_ORIGIN || (isLocalPreview ? 'http://127.0.0.1:3310' : '/dd');
  var accessToken = null;
  var refreshPromise = null;
  var featureNamePattern = /^[a-z][a-z0-9-]{1,39}$/;
  function safeApiErrorMessage(body, status) {
    var message = body && typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || /\bRoute\s+(GET|POST|PUT|PATCH|DELETE)\b|Prisma|\bSQL\b|stack trace|\.ts:\d+|\.js:\d+/i.test(message)) return status === 404 ? '请求的功能暂不可用，请稍后重试' : '请求失败，请稍后重试';
    return message;
  }

  async function awaitParentSessionRestore() {
    try {
      if (window.parent && window.parent !== window && window.parent.apiClient && typeof window.parent.apiClient.awaitSessionRestore === 'function') {
        await window.parent.apiClient.awaitSessionRestore();
        accessToken = window.parent.apiClient.getAccessToken() || accessToken;
      }
    } catch (_) { /* direct buddy-box pages do not have a same-origin parent client */ }
  }

  async function refreshSession() {
    if (!refreshPromise) {
      refreshPromise = fetch(base + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}'
      }).then(async function (refresh) {
        if (!refresh.ok) throw new Error('会话已失效');
        var refreshBody = await refresh.json().catch(function () { return {}; });
        accessToken = refreshBody.accessToken || null;
        if (!accessToken) throw new Error('会话已失效');
      }).finally(function () { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function request(path, options, retry) {
    options = options || {};
    if (!retry && !accessToken) await awaitParentSessionRestore();
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    var response = await fetch(base + path, Object.assign({}, options, {
      headers: headers,
      credentials: 'include'
    }));
    if (response.status === 401 && !retry) {
      try { await refreshSession(); return request(path, options, true); } catch (_) { /* expose the original response below */ }
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(safeApiErrorMessage(body, response.status));
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function queryString(values) {
    return Object.keys(values || {}).filter(function (key) {
      return values[key] !== undefined && values[key] !== null;
    }).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(values[key]));
    }).join('&');
  }

  function safeFeatureName(value, fallback) {
    var name = String(value || '').trim().toLowerCase();
    return featureNamePattern.test(name) ? name : fallback;
  }

  function resultBody(body) {
    var record = body && body.record;
    var result = record && record.result && typeof record.result === 'object' ? record.result : {};
    return Object.assign({}, result, {
      accepted: body && body.accepted !== false,
      record: record || null
    });
  }

  function writeFeature(feature, action, payload) {
    var body = {
      feature: safeFeatureName(feature, 'buddy'),
      action: safeFeatureName(action, 'submit'),
      payload: payload && typeof payload === 'object' ? payload : {}
    };
    if (body.feature === 'box' && body.action === 'draw') {
      body.idempotencyKey = 'draw-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    return request('/api/buddy-box/features', {
      method: 'POST',
      body: JSON.stringify(body)
    }).then(resultBody);
  }

  function readFeature(feature, scope, limit) {
    var path = '/api/buddy-box/features/' + encodeURIComponent(safeFeatureName(feature, 'buddy')) + '?' + queryString({
      scope: scope || 'mine',
      limit: limit || 50
    });
    return request(path);
  }

  function readAllFeatures(scope, limit) {
    return request('/api/buddy-box/features?' + queryString({ scope: scope || 'mine', limit: limit || 100 }));
  }

  function recordsAs(records) {
    return (Array.isArray(records) ? records : []).map(function (record) {
      var result = record && record.result;
      return result && typeof result === 'object' ? Object.assign({}, result, { record: record }) : record;
    });
  }

  function latestFeatureResult(body) {
    var records = body && Array.isArray(body.records) ? body.records : [];
    if (!records.length) return { record: null };
    return resultBody({ accepted: true, record: records[0] });
  }

  function getPointAccount() {
    return request('/api/users/me/point-account');
  }

  var api = {
    updateProfile: function (payload) {
      return request('/api/users/me', { method: 'PUT', body: JSON.stringify(payload || {}) });
    },
    sendMessage: function (payload) {
      return request('/api/buddy-box/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: payload && payload.to ? payload.to.id : payload && payload.recipientId,
          text: payload && payload.text,
          source: payload && payload.source
        })
      });
    },
    applyFriend: function (profile) {
      return request('/api/buddy-box/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ recipientId: profile && (profile.id || profile.recipientId) })
      });
    },
    getInbox: function () { return request('/api/buddy-box/inbox'); },
    getConversation: function (userId) { return request('/api/buddy-box/conversations/' + encodeURIComponent(userId) + '/messages'); },
    markMessageRead: function (id) {
      return request('/api/buddy-box/messages/' + encodeURIComponent(id) + '/read', { method: 'POST', body: '{}' });
    },
    acceptFriend: function (id) {
      return request('/api/buddy-box/friend-requests/' + encodeURIComponent(id) + '/accept', { method: 'POST', body: '{}' });
    },
    rejectFriend: function (id) {
      return request('/api/buddy-box/friend-requests/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: '{}' });
    },
    publishBoard: function (payload) { return writeFeature('board', 'publish', payload); }
  };

  var adapter = {
    getRecommendations: function (action) {
      var query = queryString({ action: action || undefined });
      return request('/api/buddy-box/recommendations' + (query ? '?' + query : ''));
    },
    getPreferences: function () { return request('/api/buddy-box/preferences'); },
    getBoard: function () {
      return readFeature('board', 'mine').then(function (body) {
        return { records: Array.isArray(body.records) ? body.records : [] };
      });
    },
    getFeatureRecords: function () { return readAllFeatures('mine', 100); },
    savePreferences: function (payload) {
      return request('/api/buddy-box/preferences', { method: 'PUT', body: JSON.stringify(payload || {}) });
    },

    getTaskPlatformState: async function () {
      var values = await Promise.all([request('/api/users/me'), getPointAccount(), readFeature('coop', 'mine')]);
      return {
        user: values[0] && values[0].user ? values[0].user : null,
        tasks: recordsAs(values[2] && values[2].records),
        prestige: values[1] && values[1].account ? values[1].account.availableBalance : null,
        account: values[1] ? values[1].account : null
      };
    },
    settlePrestige: function (payload) { return writeFeature('prestige', 'settle', payload); },
    getCoopTaskCatalog: function () {
      return readFeature('coop', 'public').then(function (body) { return { tasks: recordsAs(body.records) }; });
    },
    getPrestige: async function () {
      var body = await getPointAccount();
      return {
        available: body && body.account ? body.account.availableBalance : null,
        source: 'point-account',
        account: body ? body.account : null
      };
    },
    createBox: function (payload) {
      return writeFeature(safeFeatureName(payload && payload.feature, 'box'), 'create', payload);
    },
    drawBox: function (payload) { return writeFeature('box', 'draw', payload); },
    listQuizBoxes: function () {
      return readFeature('quiz', 'public').then(function (body) { return { boxes: recordsAs(body.records) }; });
    },
    getWishPool: function () {
      return readFeature('reverse', 'public').then(function (body) { return { wishes: recordsAs(body.records) }; });
    },
    getMemoryBoxes: function () {
      return readFeature('memory', 'mine').then(function (body) { return { boxes: recordsAs(body.records) }; });
    },
    getAnonymousConversation: function (payload) {
      return readFeature('conversation', 'mine', 1).then(function (body) {
        return latestFeatureResult(body);
      });
    },
    submitAnswers: function (payload) { return writeFeature('quiz', 'submit-answers', payload); },
    reviewAnswers: function (payload) { return writeFeature('quiz', 'review-answers', payload); },
    publishWishBox: function (payload) { return writeFeature('reverse', 'publish', payload); },
    claimWishBox: function (payload) { return writeFeature('reverse', 'claim', payload); },
    createMemoryBox: function (payload) { return writeFeature('memory', 'create', payload); },
    unlockMemoryBox: function (payload) { return writeFeature('memory', 'unlock', payload); },
    setCrossSchool: function (payload) { return writeFeature('cross-school', 'set', payload); },
    getIcebreaker: function (payload) { return writeFeature('icebreaker', 'generate', payload); },
    createCoopTask: function (payload) { return writeFeature('coop', 'create', payload); },
    sendEcho: function (payload) { return writeFeature('echo', 'send', payload); },
    getCollection: function () {
      return readFeature('collection', 'mine').then(function (body) {
        return { cards: recordsAs(body.records), fragments: null };
      });
    },
    craftFragment: function (payload) { return writeFeature('fragments', 'craft', payload); },
    getRadar: function (payload) {
      return writeFeature('radar', 'summary', payload).then(function (result) {
        return Object.assign({ summary: '暂无服务端统计' }, result);
      });
    },
    getQuestionWall: function () {
      return readFeature('qa-wall', 'public').then(function (body) { return { questions: recordsAs(body.records) }; });
    },
    getGroupRooms: function () {
      return readFeature('group', 'mine').then(function (body) { return { rooms: recordsAs(body.records) }; });
    },
    getWishNotes: function () {
      return readFeature('wish-wall', 'public').then(function (body) { return { notes: recordsAs(body.records) }; });
    },
    askWall: function (payload) { return writeFeature('qa-wall', 'ask', payload); },
    createGroup: function (payload) { return writeFeature('group', 'create', payload); },
    publishWishNote: function (payload) {
      return writeFeature('wish-wall', payload && payload.claim ? 'claim' : 'publish', payload);
    },
    setSafety: function (payload) { return writeFeature('safety', 'settings', payload); },
    getSafetySettings: function () {
      return readFeature('safety', 'mine', 1).then(function (body) {
        return latestFeatureResult(body);
      });
    },
    reportHarassment: function (payload) { return writeFeature('safety', 'report', payload); },
    getEvent: function (payload) { return writeFeature('event', 'status', payload); }
  };

  window.buddyBoxApi = Object.assign(window.buddyBoxApi || {}, api);
  window.buddyBoxDataAdapter = Object.assign(window.buddyBoxDataAdapter || {}, adapter);
}());
