export const CONTENT_BLOCKED_MESSAGE = '内容包含敏感词，请修改后再提交';

// 只拦截高信号的校园社区滥用场景。通用 GFW 词表包含大量正常词汇（如“四六级”“教师资格证”），
// 会导致注册、资料、任务与反馈文本被误杀，同时同步构建 5 万余词的 Trie 还会造成首屏卡顿。
const userTextBlockedTerms = [
  '加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单', '诈骗',
  '代考', '替考', '办证', '假证', '卖淫', '嫖娼', '赌博', '毒品', '枪支', '炸药', '洗钱', '传销', '代写论文',
];

const skillBlockedTerms = [
  '加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单', '诈骗', '代考', '办证', '假证',
];

const separatorPattern = /[\s\p{P}\p{S}_]/u;

type TrieNode = {
  children: Map<string, TrieNode>;
  terminal: boolean;
};

function normalizeChar(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function normalizeWord(value: string) {
  return [...value].map(normalizeChar).join('');
}

function emptyNode(): TrieNode {
  return { children: new Map(), terminal: false };
}

function buildTrie(terms: string[]) {
  const root = emptyNode();
  for (const raw of terms) {
    const normalized = normalizeWord(raw);
    if (!normalized) continue;
    let node = root;
    for (const unit of [...normalized]) {
      let next = node.children.get(unit);
      if (!next) {
        next = emptyNode();
        node.children.set(unit, next);
      }
      node = next;
    }
    node.terminal = true;
  }
  return root;
}

const root = buildTrie(userTextBlockedTerms);

function containsBlockedTerm(value: unknown) {
  const chars = [...String(value ?? '')];
  for (let start = 0; start < chars.length; start += 1) {
    if (separatorPattern.test(chars[start])) continue;
    let node = root;
    let cursor = start;
    let matched = 0;
    while (cursor < chars.length) {
      if (separatorPattern.test(chars[cursor])) {
        cursor += 1;
        continue;
      }
      const unit = normalizeChar(chars[cursor]);
      const next = node.children.get(unit);
      if (!next) break;
      node = next;
      matched += 1;
      cursor += 1;
      if (node.terminal && matched >= 2) return true;
    }
  }
  return false;
}

export function validateUserText(value: unknown) {
  const blocked = containsBlockedTerm(value);
  return { blocked, message: blocked ? CONTENT_BLOCKED_MESSAGE : null };
}

export function validateSkillTag(value: unknown) {
  const normalized = normalizeWord(String(value ?? '').trim());
  const blocked = skillBlockedTerms.some((term) => normalized.includes(normalizeWord(term)));
  return { blocked, message: blocked ? CONTENT_BLOCKED_MESSAGE : null };
}

export function assertSafeSkillTags(...values: unknown[]) {
  if (values.some((value) => validateSkillTag(value).blocked)) {
    const error = new Error(CONTENT_BLOCKED_MESSAGE);
    error.name = 'ContentBlockedError';
    throw error;
  }
}

export function assertSafeText(...values: unknown[]) {
  if (values.some((value) => validateUserText(value).blocked)) {
    const error = new Error(CONTENT_BLOCKED_MESSAGE);
    error.name = 'ContentBlockedError';
    throw error;
  }
}

export function assertSafeJsonText(value: unknown) {
  if (typeof value === 'string') {
    assertSafeText(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertSafeJsonText);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(assertSafeJsonText);
  }
}