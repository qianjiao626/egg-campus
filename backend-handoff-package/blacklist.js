(function () {
  'use strict';

  var metrics = [];
  var state = { metric: 'all', page: 1, pageSize: 50, search: '' };
  var unsubscribe = null;
  var bound = false;
  var esc = window.escapeHtml || function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); };
  function root(id) { return document.getElementById(id); }
  function showModal(modal) {
    if (!modal) return;
    modal.style.display = 'flex';
    // rank-modal-overlay fades in only when .show is present.
    requestAnimationFrame(function () { modal.classList.add('show'); });
  }
  function hideModal(modal) {
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
  function scoreColor(score) { return score >= 7 ? '#FF6B35' : (score >= 4 ? '#FF9800' : '#4CAF50'); }
  function scoreBg(score) { return score >= 7 ? '#FFF0E5' : (score >= 4 ? '#FFF8E1' : '#E8F5E9'); }
  function formatTime(value) { try { return new Date(value).toLocaleString('zh-CN'); } catch (_) { return ''; } }
  function empty(message) { return '<div class="bl-loading">' + esc(message) + '</div>'; }

  function renderStats(stats) {
    var target = root('blStats'); if (!target) return;
    var items = [[stats.schoolCount || 0, '收录高校', '#FF6B9D'], [stats.commentCount || 0, '吐槽总数', '#FF8E53'], [Number(stats.averageScore || 0).toFixed(1), '平均吐槽分', '#4CAF50'], [stats.metricCount || 16, '评价维度', '#42A5F5']];
    target.innerHTML = items.map(function (item) { return '<div class="bl-stat"><div class="bl-stat-num" style="color:' + item[2] + '">' + esc(item[0]) + '</div><div class="bl-stat-label">' + item[1] + '</div></div>'; }).join('');
  }

  function renderExtremes(extremes) {
    var worst = extremes && extremes.worst; var best = extremes && extremes.best;
    var worstSchool = root('blWorstSchool'); var worstScore = root('blWorstScore'); var bestSchool = root('blBestSchool'); var bestScore = root('blBestScore');
    if (worstSchool) worstSchool.textContent = worst ? (worst.displayName || worst.schoolName) : '--';
    if (worstScore) worstScore.textContent = worst ? Number(worst.score || 0).toFixed(1) + ' 分' : '--';
    if (bestSchool) bestSchool.textContent = best ? (best.displayName || best.schoolName) : '--';
    if (bestScore) bestScore.textContent = best ? Number(best.score || 0).toFixed(1) + ' 分' : '--';
    var worstCard = root('blWorstCard'); var bestCard = root('blBestCard');
    if (worstCard) worstCard.onclick = worst ? function () { openSchool(worst.schoolId); } : null;
    if (bestCard) bestCard.onclick = best ? function () { openSchool(best.schoolId); } : null;
  }

  function renderTabs() {
    var target = root('blTabs'); if (!target) return;
    target.innerHTML = [{ key: 'all', name: '🏆 吐槽总榜' }].concat(metrics.map(function (metric) { return { key: metric.key, name: metric.name }; })).map(function (tab) {
      return '<button class="bl-tab ' + (tab.key === state.metric ? 'active' : '') + '" type="button" data-blacklist-tab="' + esc(tab.key) + '">' + esc(tab.name) + '</button>';
    }).join('');
    target.querySelectorAll('[data-blacklist-tab]').forEach(function (button) { button.addEventListener('click', function () { state.metric = button.getAttribute('data-blacklist-tab'); state.page = 1; load(); }); });
  }

  function renderRank(result) {
    var target = root('blRankList'); if (!target) return;
    var rows = result && (result.rows || result.list) || []; var offset = ((result && result.page) || state.page) - 1;
    if (!rows.length) target.innerHTML = empty('暂无公开吐槽，成为第一个分享体验的人吧');
    else {
      target.innerHTML = rows.map(function (row, index) {
        var score = Number(row.score || row.avgScore || 0); var badge = score >= 7 ? '🔥 吐槽重灾区' : (score >= 4 ? '⚡ 一般般' : '✨ 口碑不错');
         return '<div class="bl-rank-item" data-blacklist-school-id="' + esc(row.schoolId) + '"><span class="bl-rank-num n' + (index + 1 + offset * state.pageSize) + '">' + (index + 1 + offset * state.pageSize) + '</span><span class="bl-rank-school-name">' + esc(row.displayName || row.schoolName) + '</span><span class="bl-rank-badge ' + (score >= 7 ? 'warn' : (score < 4 ? 'ok' : '')) + '">' + badge + '</span><span class="bl-rank-meta">' + Number(row.commentCount || row.count || 0) + ' 条吐槽</span><button type="button" class="bl-rank-detail-btn" data-blacklist-detail="' + esc(row.schoolId) + '">查看详情 →</button><strong class="bl-rank-score-val" style="color:' + scoreColor(score) + '">' + score.toFixed(1) + '</strong></div>';
      }).join('');
    }
    var count = root('blRankHeadCount'); if (count) count.textContent = '共 ' + Number(result && result.total || rows.length) + ' 所高校';
    var pager = root('blacklistPager'); if (pager) pager.innerHTML = '<button type="button" ' + (state.page <= 1 ? 'disabled' : '') + ' data-blacklist-page="prev">上一页</button><span>第 ' + state.page + ' 页</span><button type="button" ' + (rows.length < state.pageSize ? 'disabled' : '') + ' data-blacklist-page="next">下一页</button>';
    if (pager) pager.querySelectorAll('[data-blacklist-page]').forEach(function (button) { button.addEventListener('click', function () { state.page += button.getAttribute('data-blacklist-page') === 'next' ? 1 : -1; load(); }); });
    var title = root('blRankHeadTitle'); if (title) { var metric = metrics.find(function (item) { return item.key === state.metric; }); title.textContent = '🔥 蛋蛋大学吐槽榜 - ' + (metric ? metric.name : '吐槽总榜'); }
  }

  function wallCard(row) {
    var score = Number(row.averageScore || row.score || 0);
    return '<article class="bl-wall-card"><div class="bl-wall-card-head"><span class="bl-wall-card-school">🏫 ' + esc(row.displayName || row.schoolName || '') + '</span><span class="bl-wall-card-score" style="color:' + scoreColor(score) + ';background:' + scoreBg(score) + '">' + score.toFixed(1) + ' 分</span><time class="bl-wall-card-time">' + esc(formatTime(row.createdAt || row.time)) + '</time></div><div class="bl-wall-card-text">' + esc(row.content || row.text || '仅留下评分') + '</div><div class="bl-wall-card-user">— ' + esc(row.nickname || row.userName || '匿名用户') + '</div></article>';
  }

  function renderWall(result) {
    var html = ((result && (result.comments || result.list)) || []).map(wallCard).join('');
    var target = root('blWallList'); var clone = root('blWallListClone');
    if (target) target.innerHTML = html || empty('暂无吐槽记录');
    if (clone) clone.innerHTML = html;
    var inner = root('blWallScrollInner'); if (inner) inner.style.animationPlayState = html ? 'running' : 'paused';
  }

  function renderSchoolDropdown(items, query, targetId) {
    var target = root(targetId || 'blSchoolDropdown'); if (!target) return;
    if (!query) { target.classList.remove('show'); target.innerHTML = ''; return; }
    var pageSearch = targetId === 'blSearchDropdown';
    target.innerHTML = items.length ? items.map(function (school) {
      var score = Number(school.score || school.avgScore || 0);
      var count = Number(school.commentCount || school.count || 0);
      var meta = pageSearch ? ' · ' + (count ? count + ' 条吐槽' : '暂无吐槽') + (score ? ' · ' + score.toFixed(1) + ' 分' : '') : '';
      return '<button type="button" class="' + (pageSearch ? 'bl-search-item' : 'bl-tousu-dropdown-item') + '" data-school-id="' + esc(school.schoolId) + '" data-school-name="' + esc(school.schoolName) + '">' + esc(school.displayName || school.schoolName) + meta + '</button>';
    }).join('') : '<button type="button" class="' + (pageSearch ? 'bl-search-item' : 'bl-tousu-dropdown-item') + ' bl-add-school" data-add-school="' + esc(query) + '">✨ 新增「' + esc(query) + '」' + (pageSearch ? '，我来第一个吐槽！' : '为新学校') + '</button>';
    target.classList.add('show');
    target.querySelectorAll('[data-school-id]').forEach(function (button) { button.addEventListener('click', function () {
      var name = button.getAttribute('data-school-name'); target.classList.remove('show');
       if (pageSearch) { var pageInput = root('blSearchInput'); if (pageInput) pageInput.value = name; state.search = name; openSchool(button.getAttribute('data-school-id')); }
      else { var formInput = root('blSchoolSearch'); if (formInput) formInput.value = name; state.selectedSchool = name; state.selectedSchoolId = button.getAttribute('data-school-id'); }
    }); });
    var add = target.querySelector('[data-add-school]'); if (add) add.addEventListener('click', function () {
      var name = add.getAttribute('data-add-school'); target.classList.remove('show');
      if (pageSearch) { var pageInput = root('blSearchInput'); if (pageInput) pageInput.value = ''; openSubmit(name); }
      else { var formInput = root('blSchoolSearch'); if (formInput) formInput.value = name; state.selectedSchool = name; state.selectedSchoolId = ''; }
    });
  }

  async function searchSchool(query, showDropdown) {
    query = String(query || '').trim();
    if (!query) { if (showDropdown) { renderSchoolDropdown([], '', 'blSearchDropdown'); renderSchoolDropdown([], '', 'blSchoolDropdown'); } return; }
    try { var result = await window.apiClient.blacklistSearch(query); if (showDropdown) { var form = root('tousuFormModal'); var pageDropdown = root('blSearchDropdown'); var targetId = form && form.style.display === 'flex' && root('blSchoolDropdown') ? 'blSchoolDropdown' : (pageDropdown ? 'blSearchDropdown' : 'blSchoolDropdown'); renderSchoolDropdown(result.schools || result.list || [], query, targetId); } } catch (error) { if (window.toast) window.toast(error.message || '搜索失败'); }
  }

  function renderFormMetrics() {
    var target = root('blRatingItems'); if (!target) return;
    target.innerHTML = metrics.map(function (metric, index) { return '<div class="bl-tousu-rating-item"><div class="bl-tousu-rating-name"><span>' + esc(metric.name) + '</span><button class="bl-tousu-rank-btn" type="button" data-metric-rank="' + esc(metric.key) + '">🏆 排名</button></div><div class="bl-tousu-slider-row"><input class="bl-tousu-slider" type="range" min="0" max="10" step="1" value="0" data-blacklist-metric="' + esc(metric.key) + '"><output class="bl-tousu-rating-val" id="blVal_' + index + '">0</output></div></div>'; }).join('');
    target.querySelectorAll('[data-blacklist-metric]').forEach(function (input) { input.addEventListener('input', function () { var output = root('blVal_' + Array.prototype.indexOf.call(target.querySelectorAll('[data-blacklist-metric]'), input)); if (output) output.textContent = input.value; }); });
    target.querySelectorAll('[data-metric-rank]').forEach(function (button) { button.addEventListener('click', function () { openMetricRank(button.getAttribute('data-metric-rank')); }); });
  }

  function bind() {
    if (bound) return; bound = true;
    var search = root('blSearchInput'); if (search) search.addEventListener('input', function () { state.search = search.value; searchSchool(search.value, true); });
    var refresh = root('blacklistRefresh'); if (refresh) refresh.addEventListener('click', load);
    var submitButton = root('blacklistSubmitBtn'); if (submitButton) submitButton.addEventListener('click', openSubmit);
    var closeSubmit = root('tousuClose'); if (closeSubmit) closeSubmit.addEventListener('click', closeSubmitForm);
    var submit = root('tousuSubmit'); if (submit) submit.addEventListener('click', submitForm);
    var schoolSearch = root('blSchoolSearch'); if (schoolSearch) schoolSearch.addEventListener('input', function () { searchSchool(schoolSearch.value, true); });
    var rankList = root('blRankList'); if (rankList) rankList.addEventListener('click', function (event) { var button = event.target.closest('[data-blacklist-detail]'); if (button) { event.preventDefault(); openSchool(button.getAttribute('data-blacklist-detail')); } });
    var metricClose = root('blMetricRankClose'); if (metricClose) metricClose.addEventListener('click', closeMetricRank);
    var detailClose = root('blSchoolDetailClose'); if (detailClose) detailClose.addEventListener('click', closeSchoolDetail);
    ['tousuFormModal', 'blMetricRankModal', 'blSchoolDetailModal'].forEach(function (id) { var modal = root(id); if (modal) modal.addEventListener('click', function (event) { if (event.target === modal) hideModal(modal); }); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { closeSubmitForm(); closeMetricRank(); closeSchoolDetail(); } });
  }

  async function load() {
    bind();
    try {
      var results = await Promise.all([window.apiClient.blacklistStats(), window.apiClient.blacklistMetrics(), window.apiClient.blacklistExtremes(), window.apiClient.blacklistRank({ metric: state.metric, page: state.page, pageSize: state.pageSize }), window.apiClient.blacklistWall({ page: 1, pageSize: 20 })]);
      metrics = results[1].metrics || []; renderStats(results[0]); renderExtremes(results[2]); renderTabs(); renderRank(results[3]); renderWall(results[4]);
      if (!unsubscribe && window.DandanRealtime) unsubscribe = window.DandanRealtime.subscribe(['blacklist.updated'], load);
    } catch (error) { var rank = root('blRankList'); if (rank) rank.innerHTML = empty(error.message || '加载失败，请刷新重试'); }
  }

  function openSubmit(prefill) {
    if (!window.apiClient || !window.apiClient.isAuthenticated || !window.apiClient.isAuthenticated()) { if (window.openLoginModal) window.openLoginModal(); else if (window.toast) window.toast('请先登录'); return; }
    // Click handlers pass an Event object; only string values are valid prefill names.
    if (typeof prefill !== 'string') prefill = '';
    renderFormMetrics(); state.selectedSchool = prefill || ''; state.selectedSchoolId = ''; var input = root('blSchoolSearch'); if (input) input.value = prefill || ''; var comment = root('blComment'); if (comment) comment.value = ''; showModal(root('tousuFormModal'));
  }
  function closeSubmitForm() { hideModal(root('tousuFormModal')); }
  async function submitForm() {
    var school = root('blSchoolSearch'); var schoolName = school ? school.value.trim() : ''; if (!schoolName) { if (window.toast) window.toast('请先输入学校名称'); return; }
    var scores = {}; document.querySelectorAll('[data-blacklist-metric]').forEach(function (input) { scores[input.getAttribute('data-blacklist-metric')] = Number(input.value); });
    var comment = root('blComment');
    try { var result = await window.apiClient.submitBlacklist({ schoolId: state.selectedSchoolId || undefined, schoolName: schoolName, comment: comment ? comment.value.trim() : '', scores: scores }); closeSubmitForm(); if (window.toast) window.toast('提交成功，获得 ' + Number(result.reward && result.reward.coins || 0) + ' 蛋蛋币'); state.page = 1; await load(); } catch (error) { if (window.toast) window.toast(error.message || '提交失败'); }
  }

  async function openMetricRank(metricKey) {
    var metric = metrics.find(function (item) { return item.key === metricKey; }); if (!metric) return;
    var title = root('blMetricRankTitle'); var subtitle = root('blMetricRankSubtitle'); var icon = root('blMetricRankIcon'); if (title) title.textContent = metric.name + ' 排行'; if (subtitle) subtitle.textContent = metric.description || '分数越高吐槽越狠'; if (icon) icon.textContent = '🏆';
    var list = root('blMetricRankList'); if (list) list.innerHTML = empty('正在加载排名…'); showModal(root('blMetricRankModal'));
    try { var result = await window.apiClient.blacklistMetricRank({ metric: metricKey, page: 1, pageSize: 50 }); var rows = result.rows || result.list || []; if (list) { list.innerHTML = rows.map(function (row, index) { var score = Number(row.score || row.avgScore || 0); return '<button type="button" class="bl-metric-rank-item ' + (index < 3 ? 'top' + (index + 1) : '') + '" data-blacklist-school-id="' + esc(row.schoolId) + '"><span class="bl-metric-rank-num">' + (index + 1) + '</span><span class="bl-metric-rank-school">' + esc(row.displayName || row.schoolName) + '</span><strong class="bl-metric-rank-score" style="color:' + scoreColor(score) + '">' + score.toFixed(1) + '</strong></button>'; }).join('') || empty('暂无该指标的公开吐槽'); list.onclick = function (event) { var button = event.target.closest('[data-blacklist-school-id]'); if (button) { closeMetricRank(); openSchool(button.getAttribute('data-blacklist-school-id')); } }; } } catch (error) { if (list) list.innerHTML = empty(error.message || '排名加载失败'); }
  }
  function closeMetricRank() { hideModal(root('blMetricRankModal')); }

  async function openSchool(id) {
    var modal = root('blSchoolDetailModal'); var body = root('blSchoolDetailBody'); if (!body) return; showModal(modal); body.innerHTML = empty('正在加载学校详情…');
    try {
      var result = await window.apiClient.blacklistSchool(id); var school = result.school || {}; var avg = Number(result.avgScore || result.averageScore || 0); var metricsByKey = result.metrics || {};
      var html = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px"><div><div style="font-size:22px;font-weight:800;color:#FF6B9D">🏫 ' + esc(result.displayName || school.displayName || school.schoolName) + '</div><div style="font-size:13px;color:rgba(93,64,55,.5);margin-top:6px">' + (result.count || 0) + ' 条吐槽</div></div><div style="text-align:right"><div style="font-size:30px;font-weight:900;color:' + scoreColor(avg) + '">' + avg.toFixed(1) + '</div><div style="font-size:12px;color:rgba(93,64,55,.45)">平均吐槽分</div></div></div><div style="font-size:14px;font-weight:800;color:#5D4037;margin-bottom:14px">📋 各项指标</div>';
      metrics.forEach(function (metric) { var value = Number(metricsByKey[metric.key] || 0); html += '<div class="bl-detail-bar-wrap"><div class="bl-detail-bar-label"><span class="bl-detail-bar-name">' + esc(metric.name) + '</span><strong class="bl-detail-bar-val" style="color:' + scoreColor(value) + '">' + value.toFixed(1) + '</strong></div><div class="bl-detail-bar-track"><div class="bl-detail-bar-fill" style="width:' + (value * 10) + '%;background:linear-gradient(90deg,#81C784,' + scoreColor(value) + ')"></div></div></div>'; });
      html += '<div style="font-size:14px;font-weight:800;color:#5D4037;margin:22px 0 12px">💬 本校吐槽留言</div>'; var comments = result.comments || []; html += comments.length ? comments.slice(0, 10).map(function (row) { var score = Number(row.averageScore || 0); return '<article class="bl-detail-comment"><div class="bl-detail-comment-head"><span class="bl-detail-comment-user">' + esc(row.nickname || '匿名用户') + '</span><span class="bl-detail-comment-score" style="color:' + scoreColor(score) + ';background:' + scoreBg(score) + '">吐槽分：' + score.toFixed(1) + '</span></div><div class="bl-detail-comment-text">' + esc(row.content || '仅留下评分') + '</div><div class="bl-detail-comment-time">' + esc(formatTime(row.createdAt)) + '</div></article>'; }).join('') : '<div class="bl-detail-comment" style="text-align:center;color:rgba(93,64,55,.45)">暂无留言</div>'; body.innerHTML = html;
    } catch (error) { body.innerHTML = empty(error.message || '学校详情加载失败'); }
  }
  function closeSchoolDetail() { hideModal(root('blSchoolDetailModal')); }
  function refreshCurrentView() { return load(); }
  function search(keyword) { state.search = keyword; return searchSchool(keyword, true); }

  bind();
  window.DandanBlacklist = { load: load, refreshCurrentView: refreshCurrentView, openSubmit: openSubmit, closeSubmit: closeSubmitForm, submit: submitForm, search: search, openSchool: openSchool, page: function (delta) { state.page = Math.max(1, state.page + delta); load(); } };
}());
