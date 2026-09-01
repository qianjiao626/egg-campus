(function () {
  'use strict';

  var isLocalPreview = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  var API_ORIGIN = window.DANDAN_API_ORIGIN || (isLocalPreview ? 'http://127.0.0.1:3310' : '/dd');
  var accessToken = null;
  var refreshToken = null;
  var resetVerification = null;
  var resetCountdownTimer = null;
  var activeRequests = 0;
  var refreshPromise = null;
  var sessionRestoreResolve = null;
  var sessionRestoreStarted = false;
  var sessionRestorePromise = new Promise(function (resolve) { sessionRestoreResolve = resolve; });
  var hydrateUserPromise = null;

  async function awaitSessionRestore() {
    return sessionRestorePromise;
  }

  function isSessionEndpoint(path) {
    return String(path || '').indexOf('/api/auth/') === 0;
  }

  function updateRequestProgress(delta) {
    activeRequests = Math.max(0, activeRequests + delta);
    window.dispatchEvent(new CustomEvent('dandan:request-progress', { detail: { active: activeRequests > 0 } }));
    var bar = document.getElementById('dandanRequestProgress');
    if (!bar && document.body) {
      bar = document.createElement('div');
      bar.id = 'dandanRequestProgress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    if (bar) bar.classList.toggle('active', activeRequests > 0);
  }

  function setAccessToken(value) {
    accessToken = value || null;
    window.dispatchEvent(new CustomEvent('dandan:access-token', { detail: accessToken }));
  }

  function safeApiErrorMessage(body, status) {
    var message = body && typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return '请求失败，请稍后重试';
    if (/\bRoute\s+(GET|POST|PUT|PATCH|DELETE)\b|Prisma|\bSQL\b|stack trace|\.ts:\d+|\.js:\d+/i.test(message)) {
      return status === 404 ? '请求的功能暂不可用，请稍后重试' : '请求失败，请稍后重试';
    }
    return message;
  }

  async function request(path, options, retry) {
    options = options || {};
    if (!retry && !accessToken && !isSessionEndpoint(path)) await awaitSessionRestore();
    var headers = Object.assign({}, options.headers || {});
    if (options.body != null) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    updateRequestProgress(1);
    var response;
    try {
      response = await fetch(API_ORIGIN + path, Object.assign({}, options, { headers: headers, credentials: 'include' }));
    } finally {
      updateRequestProgress(-1);
    }
    if (response.status === 401 && !retry) {
      try { await apiClient.refresh(); return request(path, options, true); } catch (_) { /* fall through */ }
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(safeApiErrorMessage(body, response.status)); error.code = body.error; error.status = response.status; throw error; }
    return body;
  }

  async function requestMultipart(path, formData, retry) {
    if (!retry && !accessToken && !isSessionEndpoint(path)) await awaitSessionRestore();
    var headers = {};
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    updateRequestProgress(1);
    var response;
    try {
      response = await fetch(API_ORIGIN + path, { method: 'POST', body: formData, headers: headers, credentials: 'include' });
    } finally {
      updateRequestProgress(-1);
    }
    if (response.status === 401 && !retry) {
      try { await apiClient.refresh(); return requestMultipart(path, formData, true); } catch (_) { /* fall through */ }
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(safeApiErrorMessage(body, response.status)); error.code = body.error; error.status = response.status; throw error; }
    return body;
  }

  function buildQuery(values) {
    var params = new URLSearchParams();
    Object.keys(values || {}).forEach(function (key) {
      var value = values[key];
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    var query = params.toString();
    return query ? '?' + query : '';
  }

  var apiClient = window.apiClient = {
    validateUserText: function (value) {
      if (window.DandanSensitiveFilter && window.DandanSensitiveFilter.containsBlockedTerm(value)) {
        return '内容包含敏感词，请修改后再提交';
      }
      var terms = ['加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单', '诈骗', '代考', '替考', '办证', '假证', '卖淫', '嫖娼', '赌博', '毒品', '枪支', '炸药', '洗钱', '传销', '代写论文'];
      var text = String(value == null ? '' : value).replace(/\s+/g, '');
      return terms.some(function (term) { return text.indexOf(term) >= 0; }) ? '内容包含敏感词，请修改后再提交' : null;
    },
    validateSkillTag: function (value) {
      var text = String(value == null ? '' : value).replace(/\s+/g, '');
      var terms = ['加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单', '诈骗', '代考', '办证', '假证'];
      return terms.some(function (term) { return text.indexOf(term) >= 0; }) ? '内容包含敏感词，请修改后再提交' : null;
    },
    createTask: function (payload) { return request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }); },
    trackEvent: function (eventType, eventData, page) { return request('/api/analytics/event', { method: 'POST', body: JSON.stringify({ eventType: eventType, eventData: eventData, page: page }) }); },
    publicTasks: function () { return request('/api/tasks'); },
    reviewQueue: function () { return request('/api/admin/tasks/review-queue'); },
    updateTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) }); },
    myTasks: function (status) { return request('/api/tasks/mine' + (status ? '?status=' + encodeURIComponent(status) : '')); },
    myClaimedTasks: function () { return request('/api/tasks/claimed'); },
    reviewTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id) + '/review', { method: 'PATCH', body: JSON.stringify(payload) }); },
    claimTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id) + '/claim', { method: 'POST', body: JSON.stringify(payload || {}) }); },
    abandonTask: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/abandon', { method: 'POST' }); },
    submitTask: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/submit', { method: 'POST' }); },
    taskClaims: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/claims'); },
    taskDetail: function (id) { return request('/api/tasks/' + encodeURIComponent(id)); },
    assignTaskClaims: function (id, claimIds) { return request('/api/tasks/' + encodeURIComponent(id) + '/claims/assign', { method: 'PATCH', body: JSON.stringify({ claimIds: claimIds || [] }) }); },
    completeTask: function (id, claimId) { return request('/api/tasks/' + encodeURIComponent(id) + '/complete', { method: 'POST', body: JSON.stringify({ claimId: claimId || null }) }); },
    cancelTask: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }); },
    myTaskCancellationRequests: function () { return request('/api/tasks/cancellation-requests/mine'); },
    createTaskCancellationRequest: function (id, reason) { return request('/api/tasks/' + encodeURIComponent(id) + '/cancellation-requests', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    respondTaskCancellationRequest: function (taskId, requestId, status) { return request('/api/tasks/' + encodeURIComponent(taskId) + '/cancellation-requests/' + encodeURIComponent(requestId) + '/respond', { method: 'POST', body: JSON.stringify({ status: status }) }); },
    rateTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id) + '/rating', { method: 'POST', body: JSON.stringify(payload) }); },
    sendTaskInvite: function (targetUserId, skills) { return request('/api/task-invites', { method: 'POST', body: JSON.stringify({ targetUserId: targetUserId, skills: skills || [] }) }); },
    submitFeedback: function (payload) { return request('/api/feedback', { method: 'POST', body: JSON.stringify(payload) }); },
    myFeedback: function () { return request('/api/feedback/mine'); },
    addFeedbackMessage: function (id, content) { return request('/api/feedback/' + encodeURIComponent(id) + '/messages', { method: 'POST', body: JSON.stringify({ content: content }) }); },
    reopenFeedback: function (id, reason) { return request('/api/feedback/' + encodeURIComponent(id) + '/reopen', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    uploadFeedbackAttachments: function (id, files) {
      var form = new FormData(); Array.prototype.forEach.call(files || [], function (file) { form.append('files', file); });
      return requestMultipart('/api/feedback/' + encodeURIComponent(id) + '/attachments', form);
    },
    downloadFeedbackAttachment: async function (feedbackId, attachmentId, originalName) {
      var headers = {}; if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
      var response = await fetch(API_ORIGIN + '/api/feedback/' + encodeURIComponent(feedbackId) + '/attachments/' + encodeURIComponent(attachmentId), { headers: headers, credentials: 'include' });
      if (!response.ok) { var body = await response.json().catch(function () { return {}; }); throw new Error(safeApiErrorMessage(body, response.status)); }
      var blob = await response.blob(); var url = URL.createObjectURL(blob); var anchor = document.createElement('a'); anchor.href = url; anchor.download = originalName || 'attachment'; anchor.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },
    adminFeedback: function () { return request('/api/admin/feedback'); },
    updateFeedback: function (id, payload) { return request('/api/admin/feedback/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) }); },
    hideFeedbackAttachment: function (feedbackId, attachmentId, reason) { return request('/api/admin/feedback/' + encodeURIComponent(feedbackId) + '/attachments/' + encodeURIComponent(attachmentId) + '/hide', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    inquiries: function () { return request('/api/inquiries'); },
    myInquiries: function () { return request('/api/inquiries/mine'); },
    createInquiry: function (payload) { return request('/api/inquiries', { method: 'POST', body: JSON.stringify(payload) }); },
    inquiryReplies: function (id) { return request('/api/inquiries/' + encodeURIComponent(id) + '/replies'); },
    replyInquiry: function (id, content, meta) { return request('/api/inquiries/' + encodeURIComponent(id) + '/replies', { method: 'POST', body: JSON.stringify(Object.assign({ content: content }, meta || {})) }); },
    adoptInquiry: function (id, replyId) { return request('/api/inquiries/' + encodeURIComponent(id) + '/adopt/' + encodeURIComponent(replyId), { method: 'POST' }); },
    likeInquiry: function (id) { return request('/api/inquiries/' + encodeURIComponent(id) + '/like', { method: 'POST' }); },
    likeInquiryReply: function (id, replyId) { return request('/api/inquiries/' + encodeURIComponent(id) + '/replies/' + encodeURIComponent(replyId) + '/like', { method: 'POST' }); },
    refundExpiredInquiries: function () { return request('/api/admin/inquiries/refund-expired', { method: 'POST' }); },
    unreadNotifications: function () { return request('/api/notifications/unread'); },
    markNotificationRead: function (id) { return request('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' }); },
    markAllNotificationsRead: function () { return request('/api/notifications/read-all', { method: 'POST' }); },
    sendCode: function (channel, target, purpose) {
      return request('/api/auth/verification-codes', { method: 'POST', body: JSON.stringify({ channel: channel, target: target, purpose: purpose }) });
    },
    verifyCode: function (channel, target, purpose, code) {
      return request('/api/auth/verification-codes/verify', { method: 'POST', body: JSON.stringify({ channel: channel, target: target, purpose: purpose, code: code }) });
    },
    requestPasswordReset: function (channel, target) {
      return request('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ channel: channel, target: target }) });
    },
    confirmPasswordReset: function (channel, target, verificationToken, newPassword) {
      return request('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ channel: channel, target: target, verificationToken: verificationToken, newPassword: newPassword }) });
    },
    register: async function (payload) {
      var result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      setAccessToken(result.accessToken); refreshToken = result.refreshToken || refreshToken;
      return result;
    },
    login: async function (identifier, password) {
      var result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: identifier, password: password }) });
      setAccessToken(result.accessToken); refreshToken = result.refreshToken || refreshToken;
      return result;
    },
    me: function () { return request('/api/users/me'); },
    updateMe: function (payload) { return request('/api/users/me', { method: 'PUT', body: JSON.stringify(payload || {}) }); },
    publicProfile: function (id) { return request('/api/users/' + encodeURIComponent(id) + '/public-profile'); },
    adminAvatar: function () { return request('/api/admin/avatar'); },
    updateAdminAvatar: function (assetPath) { return request('/api/admin/avatar', { method: 'PUT', body: JSON.stringify({ assetPath: assetPath }) }); },
    adminPermissions: function () { return request('/api/admin/permissions'); },
    adminRoles: function () { return request('/api/admin/roles'); },
    createAdminRole: function (payload) { return request('/api/admin/roles', { method: 'POST', body: JSON.stringify(payload) }); },
    updateAdminRole: function (id, payload) { return request('/api/admin/roles/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) }); },
    adminUsers: function (query) { return request('/api/admin/users' + (query ? '?q=' + encodeURIComponent(query) : '')); },
    adminDashboardStats: function (startDate, endDate) { return request('/api/admin/dashboard/stats?startDate=' + encodeURIComponent(startDate) + '&endDate=' + encodeURIComponent(endDate)); },
    adminUserDetail: function (userId) { return request('/api/admin/users/' + encodeURIComponent(userId)); },
    adminCertifyUser: function (userId, certified) { return request('/api/admin/users/' + encodeURIComponent(userId) + '/certify', { method: 'POST', body: JSON.stringify({ certified: certified }) }); },
    userRoleGrants: function (id) { return request('/api/admin/users/' + encodeURIComponent(id) + '/roles'); },
    createRoleGrant: function (payload) { return request('/api/admin/role-grants', { method: 'POST', body: JSON.stringify(payload) }); },
    revokeRoleGrant: function (id, reason) { return request('/api/admin/role-grants/' + encodeURIComponent(id) + '/revoke', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    roleGrantAudit: function () { return request('/api/admin/role-grant-audit'); },
    stats: function () { return request('/api/users/me/stats'); },
    myRatings: function () { return request('/api/users/me/ratings'); },
    pointAccount: function () { return request('/api/users/me/point-account'); },
    pointTransactions: function (limit) { return request('/api/users/me/point-transactions' + (limit ? '?limit=' + encodeURIComponent(limit) : '')); },
    invitations: function () { return request('/api/users/me/invitations'); },
    uploadShopImages: function (files) {
      var form = new FormData(); Array.prototype.forEach.call(files || [], function (file) { form.append('files', file); });
      return requestMultipart('/api/shop/images', form);
    },
    resolveShopAssetUrl: function (url) {
      var value = String(url || '');
      return value.indexOf('/api/') === 0 ? API_ORIGIN + value : value;
    },
    shopProducts: function (query) { return request('/api/shop/products' + buildQuery(query)); },
    shopProduct: function (id) { return request('/api/shop/products/' + encodeURIComponent(id)); },
    shopCart: function () { return request('/api/shop/cart'); },
    addShopCartItem: function (payload) { return request('/api/shop/cart', { method: 'POST', body: JSON.stringify(payload) }); },
    updateShopCartItem: function (id, quantity) { return request('/api/shop/cart/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ quantity: quantity }) }); },
    removeShopCartItem: function (id) { return request('/api/shop/cart/' + encodeURIComponent(id), { method: 'DELETE' }); },
    shopAddresses: function () { return request('/api/shop/addresses'); },
    createShopAddress: function (payload) { return request('/api/shop/addresses', { method: 'POST', body: JSON.stringify(payload) }); },
    updateShopAddress: function (id, payload) { return request('/api/shop/addresses/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) }); },
    deleteShopAddress: function (id) { return request('/api/shop/addresses/' + encodeURIComponent(id), { method: 'DELETE' }); },
    shopOrders: function (query) { return request('/api/shop/orders' + buildQuery(query)); },
    shopOrder: function (id) { return request('/api/shop/orders/' + encodeURIComponent(id)); },
    createShopOrder: function (payload) { return request('/api/shop/orders', { method: 'POST', body: JSON.stringify(payload) }); },
    cancelShopOrder: function (id, reason) { return request('/api/shop/orders/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    confirmShopReceipt: function (id) { return request('/api/shop/orders/' + encodeURIComponent(id) + '/confirm-receipt', { method: 'POST' }); },
    reviewShopOrderItem: function (orderId, itemId, payload) { return request('/api/shop/orders/' + encodeURIComponent(orderId) + '/items/' + encodeURIComponent(itemId) + '/review', { method: 'POST', body: JSON.stringify(payload) }); },
    shopEntitlements: function () { return request('/api/shop/entitlements'); },
    publisherShopProducts: function () { return request('/api/shop/publisher/products'); },
    createPublisherShopProduct: function (payload) { return request('/api/shop/publisher/products', { method: 'POST', body: JSON.stringify(payload) }); },
    updatePublisherShopProduct: function (id, payload) { return request('/api/shop/publisher/products/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) }); },
    submitPublisherShopProduct: function (id) { return request('/api/shop/publisher/products/' + encodeURIComponent(id) + '/submit-review', { method: 'POST' }); },
    publisherShopStats: function (id) { return request('/api/shop/publisher/products/' + encodeURIComponent(id) + '/stats'); },
    adminShopProducts: function (query) { return request('/api/admin/shop/products' + buildQuery(query)); },
    reviewAdminShopProduct: function (id, payload) { return request('/api/admin/shop/products/' + encodeURIComponent(id) + '/review', { method: 'POST', body: JSON.stringify(payload) }); },
    publishAdminShopProduct: function (id) { return request('/api/admin/shop/products/' + encodeURIComponent(id) + '/publish', { method: 'POST' }); },
    offSaleAdminShopProduct: function (id) { return request('/api/admin/shop/products/' + encodeURIComponent(id) + '/off-sale', { method: 'POST' }); },
    archiveAdminShopProduct: function (id) { return request('/api/admin/shop/products/' + encodeURIComponent(id) + '/archive', { method: 'POST' }); },
    updateAdminShopInventory: function (id, stock) { return request('/api/admin/shop/products/' + encodeURIComponent(id) + '/inventory', { method: 'PATCH', body: JSON.stringify({ stock: stock }) }); },
    adminShopOrders: function (query) { return request('/api/admin/shop/orders' + buildQuery(query)); },
    shipAdminShopOrder: function (id, payload) { return request('/api/admin/shop/orders/' + encodeURIComponent(id) + '/ship', { method: 'POST', body: JSON.stringify(payload) }); },
    refundAdminShopOrder: function (id, reason) { return request('/api/admin/shop/orders/' + encodeURIComponent(id) + '/refund', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    adminShopReviews: function () { return request('/api/admin/shop/reviews'); },
    hideAdminShopReview: function (id, reason) { return request('/api/admin/shop/reviews/' + encodeURIComponent(id) + '/hide', { method: 'POST', body: JSON.stringify({ reason: reason }) }); },
    characters: function () { return request('/api/users/me/characters'); },
    setCurrentCharacter: function (category) { return request('/api/users/me/characters/current', { method: 'PUT', body: JSON.stringify({ category: category }) }); },
    leaderboard: function (category, query) {
      var base = '/api/users/leaderboard?category=' + encodeURIComponent(category || 'all');
      if (!query || typeof query !== 'object') return request(base);
      var extra = Object.assign({}, query);
      delete extra.category;
      return request(base + buildQuery(extra).replace(/^\?/, '&'));
    },
    blacklistMetrics: function () { return request('/api/blacklist/metrics'); },
    blacklistStats: function () { return request('/api/blacklist/stats'); },
    blacklistExtremes: function () { return request('/api/blacklist/extremes'); },
    blacklistRank: function (query) { return request('/api/blacklist/rank' + buildQuery(query)); },
    blacklistMetricRank: function (query) { return request('/api/blacklist/metric-rank' + buildQuery(query)); },
    blacklistSearch: function (keyword) { return request('/api/blacklist/search' + buildQuery({ keyword: keyword })); },
    blacklistWall: function (query) { return request('/api/blacklist/wall' + buildQuery(query)); },
    blacklistSchool: function (id) { return request('/api/blacklist/school/' + encodeURIComponent(id)); },
    addBlacklistSchool: function (payload) { return request('/api/blacklist/school/add', { method: 'POST', body: JSON.stringify(payload) }); },
    submitBlacklist: function (payload) { return request('/api/blacklist/submit', { method: 'POST', body: JSON.stringify(payload) }); },
    blacklistMyCount: function () { return request('/api/blacklist/my-count'); },
    refresh: async function () {
      if (!refreshPromise) {
        refreshPromise = (async function () {
          var result = await request('/api/auth/refresh', { method: 'POST', body: JSON.stringify(refreshToken ? { refreshToken: refreshToken } : {}) }, true);
          setAccessToken(result.accessToken);
          refreshToken = result.refreshToken || refreshToken;
          return result;
        })().finally(function () { refreshPromise = null; });
      }
      return refreshPromise;
    },
    restoreSession: async function () {
      try {
        await apiClient.refresh();
        var result = await apiClient.me();
        window.dispatchEvent(new CustomEvent('dandan:session-restored', { detail: result.user || null }));
        return result.user || null;
      } catch (_) {
        window.dispatchEvent(new CustomEvent('dandan:session-restored', { detail: null }));
        return null;
      }
    },
    awaitSessionRestore: awaitSessionRestore,
    isAuthenticated: function () { return Boolean(accessToken || refreshToken); },
    getAccessToken: function () { return accessToken; },
    logout: async function () {
      try {
        // Rotate the short-lived bearer first so logout does not emit a transient 401.
        try {
          var logoutRefresh = await apiClient.refresh();
          if (logoutRefresh && logoutRefresh.accessToken) setAccessToken(logoutRefresh.accessToken);
        } catch (_) { /* already expired or signed out */ }
        if (accessToken) await request('/api/auth/logout', { method: 'POST' });
      } finally {
        setAccessToken(null);
        refreshToken = null;
      }
    },
    get resetVerification() { return resetVerification; },
    set resetVerification(value) { resetVerification = value; }
  };
  window.validateDandanText = function (value) { return apiClient.validateUserText(value) === null; };

  function applyAuthenticatedUser(user) {
    USER = Object.assign({}, USER, user || {}, { registered: true });
    USER.isAdmin = Boolean(USER.isAdministrator || USER.isAdmin || USER.role === 'admin');
    if (window.DandanAppState) {
      window.DandanAppState.setState({ authStatus: 'authenticated', currentUser: USER });
    }
    return USER;
  }
  window.applyAuthenticatedUser = applyAuthenticatedUser;

  function setLoading(button, loading, label) { if (!button) return; button.disabled = loading; button.textContent = loading ? '处理中…' : label; }
  function startResetCountdown(seconds) {
    var button = document.getElementById('resetSendCodeBtn');
    var hint = document.getElementById('resetCodeHint');
    clearInterval(resetCountdownTimer);
    var remaining = seconds;
    function tick() {
      if (button) { button.disabled = remaining > 0; button.textContent = remaining > 0 ? remaining + ' 秒后重发' : '重新获取'; }
      if (hint) hint.textContent = remaining > 0 ? '验证码有效期 5 分钟，请勿泄露给他人' : '';
      remaining -= 1;
      if (remaining < 0) clearInterval(resetCountdownTimer);
    }
    tick(); resetCountdownTimer = setInterval(tick, 1000);
  }

  window.openForgotPassword = function () {
    document.getElementById('forgotPasswordOverlay').style.display = 'flex';
    document.getElementById('resetTarget').focus();
  };
  window.closeForgotPassword = function () {
    clearInterval(resetCountdownTimer);
    resetVerification = null;
    document.getElementById('forgotPasswordOverlay').style.display = 'none';
  };
  window.sendPasswordResetCode = async function () {
    var target = (document.getElementById('resetTarget').value || '').trim();
    if (!target) { toast('请先填写邮箱'); return; }
    var button = document.getElementById('resetSendCodeBtn');
    setLoading(button, true, '获取验证码');
    try {
      var result = await apiClient.requestPasswordReset('email', target);
      startResetCountdown(result.resendAfterSeconds || 60);
      toast('如果账号存在，验证码已发送');
    } catch (error) {
      setLoading(button, false, '获取验证码');
      toast(error.message || '验证码发送失败');
    }
  };
  window.confirmPasswordReset = async function () {
    var target = (document.getElementById('resetTarget').value || '').trim();
    var code = (document.getElementById('resetCode').value || '').trim();
    var password = document.getElementById('resetNewPassword').value || '';
    var confirm = document.getElementById('resetConfirmPassword').value || '';
    if (!target || !/^\d{6}$/.test(code) || !password || !confirm) { toast('请完整填写找回密码信息'); return; }
    if (password !== confirm) { toast('两次密码不一致'); return; }
    var button = document.getElementById('resetSubmitBtn');
    setLoading(button, true, '重置密码');
    try {
      var verified = await apiClient.verifyCode('email', target, 'reset_password', code);
      resetVerification = verified.verificationToken;
      await apiClient.confirmPasswordReset('email', target, resetVerification, password);
      closeForgotPassword();
      toast('密码已重置，请使用新密码登录');
      openLoginModal();
    } catch (error) {
      toast(error.message || '重置密码失败，请检查验证码');
    } finally {
      setLoading(button, false, '重置密码');
    }
  };

  window.doStudentLogin = async function () {
    var identifier = (document.getElementById('loginNickname').value || '').trim();
    var password = document.getElementById('loginPassword').value || '';
    if (!identifier || !password) { toast('请输入账号和密码'); return; }
    try {
      var result = await apiClient.login(identifier, password);
      var user = result.user;
      applyAuthenticatedUser(Object.assign({}, user, { points: 0, exp: 0 }));
      await hydrateUserState();
      USER.isAdmin = Boolean(USER.isAdministrator);
      closeLoginModal(); login(USER.isAdmin ? 'admin' : 'student'); toast('登录成功，欢迎回来');
    } catch (error) { toast(error.message || '账号或密码错误'); }
  };

  async function hydrateUserState() {
    if (hydrateUserPromise) return hydrateUserPromise;
    hydrateUserPromise = (async function () {
    var results = await Promise.allSettled([apiClient.me(), apiClient.stats(), apiClient.pointAccount(), apiClient.characters()]);
    if (results[0].status === 'fulfilled' && results[0].value.user) USER = Object.assign({}, USER, results[0].value.user);
    if (results[1].status === 'fulfilled' && results[1].value.stats) {
      USER.stats = results[1].value.stats;
      USER.exp = Number(results[1].value.stats.experience || 0);
    }
    if (results[2].status === 'fulfilled' && results[2].value.account) USER.points = results[2].value.account.availableBalance;
    if (results[3].status === 'fulfilled' && results[3].value.characters) {
      var currentCharacter = null;
      results[3].value.characters.forEach(function (character) {
        if (!CHAR_STATE.characters[character.category]) return;
        CHAR_STATE.characters[character.category].unlocked = character.unlocked;
        CHAR_STATE.characters[character.category].count = character.count;
        if (character.isCurrent) { CHAR_STATE.current = character.category; currentCharacter = character; }
      });
      if (window.DandanAppState) window.DandanAppState.setState({ currentCharacter: currentCharacter });
    }
    applyAuthenticatedUser(USER);
    })().finally(function () { hydrateUserPromise = null; });
    return hydrateUserPromise;
  }
  window.hydrateUserState = hydrateUserState;

  window.doRegister = async function () {
    var nick = document.getElementById('regNickname').value.trim();
    var email = document.getElementById('regEmail').value.trim();
    var inviteCode = document.getElementById('regInviteCode').value.trim().toUpperCase();
    var password = document.getElementById('regPwd').value;
    var confirm = document.getElementById('regPwdConfirm').value;
    var ageText = document.getElementById('regAge').value.trim();
    var age = ageText ? Number(ageText) : null;
    if (!nick || !password || !confirm) { toast('请填写昵称和密码'); return; }
    if (nick.length < 2 || nick.length > 50) { toast('昵称需要 2-50 个字符'); return; }
    if (password.length < 8 || password.length > 128) { toast('密码需要 8-128 位'); return; }
    if (password !== confirm) { toast('两次密码不一致'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('邮箱格式不正确'); return; }
    if (inviteCode && !/^[A-Z0-9]{6,20}$/.test(inviteCode)) { toast('邀请码应为 6-20 位字母或数字'); return; }
    if (ageText && (!Number.isInteger(age) || age < 13 || age > 100)) { toast('年龄需要填写 13-100 之间的整数'); return; }
    var profileTextFields = [
      ['昵称', nick],
      ['学校', document.getElementById('regSchool').value.trim()],
      ['专业', document.getElementById('regMajor').value.trim()],
      ['城市', document.getElementById('regCity').value.trim()],
      ['年级', document.getElementById('regGrade').value.trim()]
    ];
    for (var fieldIndex = 0; fieldIndex < profileTextFields.length; fieldIndex += 1) {
      var profileError = apiClient.validateUserText(profileTextFields[fieldIndex][1]);
      if (profileError) { toast(profileError); return; }
    }
    var button = document.getElementById('regSubmitBtn'); setLoading(button, true, '注册并登录');
    try {
      var result = await apiClient.register({ nickname: nick, email: email || null, password: password, inviteCode: inviteCode || null, school: document.getElementById('regSchool').value.trim() || null, major: document.getElementById('regMajor').value.trim() || null, city: document.getElementById('regCity').value.trim() || null, grade: document.getElementById('regGrade').value.trim() || null, age: age, mbtiType: regMbtiType || null, mbtiGroup: regMbtiGroup || null, eggCategory: regSelectedCat || null });
      applyAuthenticatedUser(Object.assign({}, result.user, { isAdmin: false, points: 0, exp: 0 }));
      await hydrateUserState();
      closeRegModal(); login('student'); toast('注册成功，欢迎来到蛋蛋世界');
    } catch (error) { toast(error.message || '注册失败，请检查填写内容'); }
    finally { setLoading(button, false, '注册并登录'); }
  };

  var originalLogout = window.logout;
  window.logout = async function (silent) { await apiClient.logout().catch(function () {}); originalLogout(silent); };

  function restoreOnLoad() {
    if (sessionRestoreStarted) return sessionRestorePromise;
    sessionRestoreStarted = true;
    apiClient.restoreSession().then(function (user) {
      sessionRestoreResolve(user);
    }, function () {
      sessionRestoreResolve(null);
    });
    return sessionRestorePromise;
  }
  restoreOnLoad();
}());
