import { readFileSync } from 'node:fs';

export const CONTENT_BLOCKED_MESSAGE = '内容包含敏感词，请修改后再提交';

const fallbackTerms = ['加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单', '诈骗'];
const safeDomainTerms = new Set(['测试', '任务', '时间', '南京大', '联系方式', '联系']);
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

function loadBundledTerms() {
  const candidates = [
    new URL('./data/zh-sensitive-words.txt', import.meta.url),
    new URL('../../src/data/zh-sensitive-words.txt', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8').split(/\r?\n/).concat(fallbackTerms);
    } catch {
      // The second location is used after TypeScript has emitted dist/src.
    }
  }
  return fallbackTerms;
}

function buildTrie() {
  const root = emptyNode();
  for (const raw of loadBundledTerms()) {
    const word = raw.replace(/^\uFEFF/, '').trim();
    if (!word || word.startsWith('#')) continue;
    const normalized = normalizeWord(word);
    if ((normalized.length < 3 && !fallbackTerms.includes(word)) || safeDomainTerms.has(normalized)) continue;
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

const root = buildTrie();

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
