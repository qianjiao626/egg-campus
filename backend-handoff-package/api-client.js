(function () {
  'use strict';

  var isLocalPreview = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  var API_ORIGIN = window.DANDAN_API_ORIGIN || (isLocalPreview ? 'http://127.0.0.1:3310' : '/dd');
  var accessToken = null;
  var refreshToken = null;
  var registrationVerification = null;
  var resetVerification = null;
  var countdownTimer = null;
  var resetCountdownTimer = null;

  async function request(path, options, retry) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    var response = await fetch(API_ORIGIN + path, Object.assign({}, options, { headers: headers, credentials: 'include' }));
    if (response.status === 401 && !retry) {
      try { await apiClient.refresh(); return request(path, options, true); } catch (_) { /* fall through */ }
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(body.message || '请求失败'); error.code = body.error; error.status = response.status; throw error; }
    return body;
  }

  var apiClient = window.apiClient = {
    validateUserText: function (value) {
      if (window.DandanSensitiveFilter && window.DandanSensitiveFilter.containsBlockedTerm(value)) {
        return '内容包含敏感词，请修改后再提交';
      }
      var terms = ['加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单'];
      var text = String(value == null ? '' : value).replace(/\s+/g, '');
      return terms.some(function (term) { return text.indexOf(term) >= 0; }) ? '内容包含敏感词，请修改后再提交' : null;
    },
    createTask: function (payload) { return request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }); },
    myTasks: function (status) { return request('/api/tasks/mine' + (status ? '?status=' + encodeURIComponent(status) : '')); },
    reviewTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id) + '/review', { method: 'PATCH', body: JSON.stringify(payload) }); },
    claimTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id) + '/claim', { method: 'POST', body: JSON.stringify(payload || {}) }); },
    submitTask: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/submit', { method: 'POST' }); },
    taskClaims: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/claims'); },
    assignTaskClaims: function (id, claimIds) { return request('/api/tasks/' + encodeURIComponent(id) + '/claims/assign', { method: 'PATCH', body: JSON.stringify({ claimIds: claimIds || [] }) }); },
    completeTask: function (id, claimId) { return request('/api/tasks/' + encodeURIComponent(id) + '/complete', { method: 'POST', body: JSON.stringify({ claimId: claimId || null }) }); },
    cancelTask: function (id) { return request('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }); },
    rateTask: function (id, payload) { return request('/api/tasks/' + encodeURIComponent(id) + '/rating', { method: 'POST', body: JSON.stringify(payload) }); },
    submitFeedback: function (payload) { return request('/api/feedback', { method: 'POST', body: JSON.stringify(payload) }); },
    myFeedback: function () { return request('/api/feedback/mine'); },
    adminFeedback: function () { return request('/api/admin/feedback'); },
    updateFeedback: function (id, payload) { return request('/api/admin/feedback/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(payload) }); },
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
      accessToken = result.accessToken; refreshToken = result.refreshToken || refreshToken;
      return result;
    },
    login: async function (identifier, password) {
      var result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: identifier, password: password }) });
      accessToken = result.accessToken; refreshToken = result.refreshToken || refreshToken;
      return result;
    },
    me: function () { return request('/api/users/me'); },
    updateMe: function (payload) { return request('/api/users/me', { method: 'PUT', body: JSON.stringify(payload || {}) }); },
    stats: function () { return request('/api/users/me/stats'); },
    pointAccount: function () { return request('/api/users/me/point-account'); },
    pointTransactions: function (limit) { return request('/api/users/me/point-transactions' + (limit ? '?limit=' + encodeURIComponent(limit) : '')); },
    characters: function () { return request('/api/users/me/characters'); },
    refresh: async function () {
      var result = await request('/api/auth/refresh', { method: 'POST', body: JSON.stringify(refreshToken ? { refreshToken: refreshToken } : {}) }, true);
      accessToken = result.accessToken; refreshToken = result.refreshToken || refreshToken;
      return result;
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
    isAuthenticated: function () { return Boolean(accessToken || refreshToken); },
    logout: async function () {
      try {
        // A reload starts with only the HttpOnly refresh cookie. Obtain a short-lived
        // access token first so logout can revoke the persisted server session too.
        if (!accessToken) {
          try { await apiClient.refresh(); } catch (_) { /* already expired or signed out */ }
        }
        if (accessToken) await request('/api/auth/logout', { method: 'POST' });
      } finally {
        accessToken = null;
        refreshToken = null;
      }
    },
    get registrationVerification() { return registrationVerification; },
    set registrationVerification(value) { registrationVerification = value; },
    get resetVerification() { return resetVerification; },
    set resetVerification(value) { resetVerification = value; }
  };
  window.validateDandanText = function (value) { return apiClient.validateUserText(value) === null; };

  function setLoading(button, loading, label) { if (!button) return; button.disabled = loading; button.textContent = loading ? '处理中…' : label; }
  function startCountdown(seconds) {
    var button = document.getElementById('regSendCodeBtn');
    var hint = document.getElementById('regCodeHint');
    clearInterval(countdownTimer);
    var remaining = seconds;
    function tick() { if (button) { button.disabled = remaining > 0; button.textContent = remaining > 0 ? remaining + ' 秒后重发' : '重新获取'; } if (hint) hint.textContent = remaining > 0 ? '验证码有效期 5 分钟，请勿泄露给他人' : ''; remaining -= 1; if (remaining < 0) clearInterval(countdownTimer); }
    tick(); countdownTimer = setInterval(tick, 1000);
  }

  window.sendRegistrationCode = async function () {
    var phone = (document.getElementById('regPhone').value || '').trim();
    var email = (document.getElementById('regEmail').value || '').trim();
    var channel = phone ? 'sms' : 'email';
    var target = phone || email;
    if (!target) { toast('请先填写手机号或邮箱'); return; }
    var button = document.getElementById('regSendCodeBtn');
    setLoading(button, true, '获取验证码');
    try { var result = await apiClient.sendCode(channel, target, 'register'); startCountdown(result.resendAfterSeconds || 60); toast('验证码已发送'); }
    catch (error) { setLoading(button, false, '获取验证码'); toast(error.message || '验证码发送失败'); }
  };

  function resetChannel(target) { return /^1\d{10}$/.test(target.replace(/[\s-]/g, '')) ? 'sms' : 'email'; }
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
    if (!target) { toast('请先填写邮箱或手机号'); return; }
    var button = document.getElementById('resetSendCodeBtn');
    setLoading(button, true, '获取验证码');
    try {
      var result = await apiClient.requestPasswordReset(resetChannel(target), target);
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
      var channel = resetChannel(target);
      var verified = await apiClient.verifyCode(channel, target, 'reset_password', code);
      resetVerification = verified.verificationToken;
      await apiClient.confirmPasswordReset(channel, target, resetVerification, password);
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
      USER = Object.assign({}, USER, user, { registered: true, isAdmin: user.role === 'admin', points: 100, exp: 0 });
      await hydrateUserState();
      closeLoginModal(); login(user.role === 'admin' ? 'admin' : 'student'); toast('登录成功，欢迎回来');
    } catch (error) { toast(error.message || '账号或密码错误'); }
  };

  async function hydrateUserState() {
    var results = await Promise.allSettled([apiClient.me(), apiClient.stats(), apiClient.pointAccount(), apiClient.characters()]);
    if (results[0].status === 'fulfilled' && results[0].value.user) USER = Object.assign({}, USER, results[0].value.user);
    if (results[1].status === 'fulfilled' && results[1].value.stats) USER.stats = results[1].value.stats;
    if (results[2].status === 'fulfilled' && results[2].value.account) USER.points = results[2].value.account.availableBalance;
    if (results[3].status === 'fulfilled' && results[3].value.characters) {
      results[3].value.characters.forEach(function (character) {
        if (!CHAR_STATE.characters[character.category]) return;
        CHAR_STATE.characters[character.category].unlocked = character.unlocked;
        CHAR_STATE.characters[character.category].count = character.count;
        if (character.isCurrent) CHAR_STATE.current = character.category;
      });
    }
  }

  window.doRegister = async function () {
    var nick = document.getElementById('regNickname').value.trim();
    var email = document.getElementById('regEmail').value.trim();
    var phone = document.getElementById('regPhone').value.trim();
    var password = document.getElementById('regPwd').value;
    var confirm = document.getElementById('regPwdConfirm').value;
    var code = document.getElementById('regCode').value.trim();
    if (!nick || !password || !confirm) { toast('请填写昵称和密码'); return; }
    if (phone && !/^1\d{10}$/.test(phone.replace(/[\s-]/g, ''))) { toast('手机号格式不正确'); return; }
    if (code && !/^\d{6}$/.test(code)) { toast('验证码应为 6 位数字'); return; }
    if (password !== confirm) { toast('两次密码不一致'); return; }
    if (!regMbtiType) { toast('请选择 MBTI 类型'); return; }
    if (!regDrawResult) { toast('请先抽取你的初始蛋'); return; }
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
    var channel = phone ? 'sms' : 'email'; var target = phone || email;
    var button = document.getElementById('regSubmitBtn'); setLoading(button, true, '注册并登录');
    try {
      var verificationToken = null;
      if ((email || phone) && code) {
        var verified = await apiClient.verifyCode(channel, target, 'register', code);
        verificationToken = verified.verificationToken;
      }
      var result = await apiClient.register({ nickname: nick, email: email || null, phone: phone || undefined, password: password, verificationToken: verificationToken, school: document.getElementById('regSchool').value.trim() || null, major: document.getElementById('regMajor').value.trim() || null, city: document.getElementById('regCity').value.trim() || null, grade: document.getElementById('regGrade').value.trim() || null, age: Number(document.getElementById('regAge').value) || null, mbtiType: regMbtiType, mbtiGroup: regMbtiGroup, eggCategory: regSelectedCat });
      USER = Object.assign({}, USER, result.user, { registered: true, isAdmin: false, points: 100, exp: 0 });
      await hydrateUserState();
      closeRegModal(); login('student'); toast('注册成功，欢迎来到蛋蛋世界');
    } catch (error) { toast(error.message || '注册失败，请检查填写内容'); }
    finally { setLoading(button, false, '注册并登录'); }
  };

  var originalLogout = window.logout;
  window.logout = async function (silent) { await apiClient.logout().catch(function () {}); originalLogout(silent); };

  // Restore the server session after a reload without storing passwords or refresh tokens in Web Storage.
  function restoreOnLoad() {
    apiClient.restoreSession();
  }
  if (document.readyState === 'complete') restoreOnLoad();
  else window.addEventListener('load', restoreOnLoad, { once: true });
}());
