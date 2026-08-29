(function () {
  'use strict';

  var state = {
    authStatus: 'restoring',
    currentUser: null,
    currentCharacter: null,
    unreadCounts: {}
  };
  var listeners = new Set();

  function cloneRecord(value) {
    return value && typeof value === 'object' ? Object.assign({}, value) : value;
  }

  function getState() {
    return {
      authStatus: state.authStatus,
      currentUser: cloneRecord(state.currentUser),
      currentCharacter: cloneRecord(state.currentCharacter),
      unreadCounts: Object.assign({}, state.unreadCounts)
    };
  }

  function notify() {
    listeners.forEach(function (listener) {
      try { listener(getState()); } catch (_) { /* one view cannot block other subscribers */ }
    });
  }

  function setState(patch) {
    var next = patch && typeof patch === 'object' ? patch : {};
    if (next.authStatus === 'restoring' || next.authStatus === 'authenticated' || next.authStatus === 'guest') {
      state.authStatus = next.authStatus;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'currentUser')) {
      state.currentUser = cloneRecord(next.currentUser);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'currentCharacter')) {
      state.currentCharacter = cloneRecord(next.currentCharacter);
    }
    if (next.unreadCounts && typeof next.unreadCounts === 'object') {
      state.unreadCounts = Object.assign({}, next.unreadCounts);
    }
    notify();
    return getState();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.add(listener);
    return function () { listeners.delete(listener); };
  }

  function setUnreadCount(key, value) {
    var count = Number(value);
    count = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    state.unreadCounts[String(key)] = count;
    notify();
    return count;
  }

  function reset() {
    state = {
      authStatus: 'guest',
      currentUser: null,
      currentCharacter: null,
      unreadCounts: {}
    };
    notify();
    return getState();
  }

  window.DandanAppState = {
    getState: getState,
    setState: setState,
    subscribe: subscribe,
    setUnreadCount: setUnreadCount,
    reset: reset
  };
}());
