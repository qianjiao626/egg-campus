(function () {
  'use strict';

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function renderSessionIdentity(state, elements) {
    var snapshot = state || {};
    var target = elements || {};
    var user = snapshot.currentUser || {};
    if (snapshot.authStatus === 'authenticated') {
      var nickname = user.nickname || '用户';
      setText(target.sidebarName, nickname);
      setText(target.profileName, nickname);
      setText(target.profileSchool, user.school || '学校未填写');
      return;
    }
    if (snapshot.authStatus === 'restoring') {
      setText(target.sidebarName, '正在恢复登录状态');
      setText(target.profileName, '正在恢复登录状态');
      setText(target.profileSchool, '正在读取个人资料');
      return;
    }
    setText(target.sidebarName, '访客');
    setText(target.profileName, '未登录');
    setText(target.profileSchool, '登录后查看学校');
  }

  function renderUnreadBadge(elementOrId, value) {
    var count = Number(value);
    count = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    var element = typeof elementOrId === 'string' && typeof document !== 'undefined'
      ? document.getElementById(elementOrId)
      : elementOrId;
    if (element) {
      element.hidden = count === 0;
      element.textContent = count > 0 ? String(count) : '';
    }
    return count;
  }

  window.DandanIdentityView = {
    renderSessionIdentity: renderSessionIdentity,
    renderUnreadBadge: renderUnreadBadge
  };
}());
