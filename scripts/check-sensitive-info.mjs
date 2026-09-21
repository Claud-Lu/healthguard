#!/usr/bin/env node
/**
 * 敏感信息扫描：pre-commit 钩子与 GitHub Actions 共用的防线。
 *
 * 规则分两层：
 * 1. 内置通用规则（可安全开源）：数字个人邮箱（QQ/163/126/foxmail）、
 *    真实形态的 appKey（web_/mp_/app_ + 16 位以上随机串）、CGNAT 内网 IP 段、
 *    个人域名（在线体验站 hg.chathappy.cn 在白名单内）。
 * 2. 字面量黑名单（禁止提交进仓库）：真实公司名、域名、账号等明文词，
 *    从仓库根目录 .sensitive-deny-list（已 gitignore）或环境变量
 *    SENSITIVE_DENY_LIST（CI 中经 GitHub Secret 注入）读取，每行一个词。
 *
 * 用法：node scripts/check-sensitive-info.mjs
 * 任何命中即退出码 1，并给出文件、行号与规则名。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(root, fileURLToPath(import.meta.url));

const BUILTIN_RULES = [
  {
    name: '数字个人邮箱（QQ/163/126/foxmail）',
    pattern: /\b\d{5,11}@(?:qq|163|126|foxmail)\.com\b/gi
  },
  {
    name: '真实形态 appKey（web_/mp_/app_ 前缀 + 16 位以上随机串）',
    pattern: /\b(?:web|mp|app)_[A-Za-z0-9]{16,}\b/g
  },
  {
    name: 'CGNAT 内网网段 IP（100.64.0.0/10）',
    pattern: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g
  }
];

const DOMAIN_RULES = [
  {
    name: '个人域名 chathappy.cn（白名单：hg.chathappy.cn 在线体验站）',
    pattern: /chathappy\.cn/gi,
    allow: [/hg\.chathappy\.cn/gi]
  }
];

function loadDenyList() {
  const entries = [];
  if (process.env.SENSITIVE_DENY_LIST) {
    entries.push(...process.env.SENSITIVE_DENY_LIST.split(/\r?\n|,/));
  }
  const localFile = path.join(root, '.sensitive-deny-list');
  if (existsSync(localFile)) {
    entries.push(...readFileSync(localFile, 'utf8').split(/\r?\n/));
  }
  return [...new Set(entries.map((s) => s.trim()).filter((s) => s && !s.startsWith('#')))];
}

function listTrackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const findings = [];

function scanContent(relPath, lines) {
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    for (const rule of BUILTIN_RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        findings.push(`${relPath}:${lineNo} [${rule.name}]`);
      }
    }
    for (const rule of DOMAIN_RULES) {
      let content = line;
      for (const allow of rule.allow) {
        allow.lastIndex = 0;
        content = content.replace(allow, '');
      }
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(content)) {
        findings.push(`${relPath}:${lineNo} [${rule.name}]`);
      }
    }
    for (const word of denyList) {
      if (line.includes(word)) {
        findings.push(`${relPath}:${lineNo} [字面量黑名单] ${word}`);
      }
    }
  });
}

const denyList = loadDenyList();
const files = listTrackedFiles();
let scanned = 0;

for (const relPath of files) {
  if (relPath === SELF) continue;
  const abs = path.join(root, relPath);
  let buffer;
  try {
    buffer = readFileSync(abs);
  } catch {
    continue;
  }
  if (buffer.includes(0)) continue;
  scanned += 1;
  scanContent(relPath, buffer.toString('utf8').split(/\r?\n/));
}

if (findings.length > 0) {
  console.error(`❌ 检测到 ${findings.length} 处疑似敏感信息，禁止提交：`);
  for (const item of findings) {
    console.error(`  ${item}`);
  }
  console.error('如为误报，请调整规则或将真实敏感词维护在 .sensitive-deny-list（勿提交）。');
  process.exit(1);
}

console.log(
  `✅ 敏感信息扫描通过：${scanned} 个文件，内置规则 ${BUILTIN_RULES.length + DOMAIN_RULES.length} 条，黑名单词条 ${denyList.length} 条`
);
