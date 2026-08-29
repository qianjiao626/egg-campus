(function () {
  'use strict';
  // 只拦截高信号的校园社区滥用场景，避免通用词表把“四六级/教师资格证”等正常校园文本误杀，
  // 也避免页面加载时同步构建 5 万余词的 Trie 造成卡顿。
  var terms = [
    '加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单', '诈骗',
    '代考', '替考', '办证', '假证', '卖淫', '嫖娼', '赌博', '毒品', '枪支', '炸药', '洗钱', '传销', '代写论文'
  ];
  var separatorPattern = /[\s\p{P}\p{S}_]/u;
  function node() { return { children: new Map(), terminal: false }; }
  function normalizeChar(value) { return value.normalize('NFKC').toLocaleLowerCase(); }
  function normalizeWord(value) { return Array.from(value).map(normalizeChar).join(''); }
  var root = node();
  terms.forEach(function (raw) {
    var normalized = normalizeWord(String(raw || '').trim());
    if (!normalized) return;
    var current = root;
    Array.from(normalized).forEach(function (unit) {
      if (!current.children.has(unit)) current.children.set(unit, node());
      current = current.children.get(unit);
    });
    current.terminal = true;
  });
  function containsBlockedTerm(value) {
    var chars = Array.from(String(value == null ? '' : value));
    for (var start = 0; start < chars.length; start += 1) {
      if (separatorPattern.test(chars[start])) continue;
      var current = root;
      var cursor = start;
      var matched = 0;
      while (cursor < chars.length) {
        if (separatorPattern.test(chars[cursor])) { cursor += 1; continue; }
        var next = current.children.get(normalizeChar(chars[cursor]));
        if (!next) break;
        current = next;
        cursor += 1;
        matched += 1;
        if (current.terminal && matched >= 2) return true;
      }
    }
    return false;
  }
  window.DandanSensitiveFilter = { containsBlockedTerm: containsBlockedTerm };
}());