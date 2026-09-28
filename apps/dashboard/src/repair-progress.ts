import type { IssueSummary } from './globalStore';

export type RepairStage = 'pending' | 'repairing' | 'verification' | 'resolved';
export type RepairFilter = 'all' | RepairStage;

export function repairStage(issue: IssueSummary): RepairStage {
  if (issue.status === 'resolved' || issue.status === 'archived') return 'resolved';
  if (issue.status === 'fixed_pending_release' || issue.status === 'verifying') return 'verification';
  return issue.status === 'repairing' ? 'repairing' : 'pending';
}

export function matchesIssueFilters(issue: IssueSummary, search: string, metric: 'all' | 'error' | 'http', progress: RepairFilter): boolean {
  if (!issue.message.toLowerCase().includes(search.toLowerCase())) return false;
  if (metric === 'error' && !['error', 'js', 'promise', 'resource', 'native'].includes(issue.errorType)) return false;
  if (metric === 'http' && !['http', 'request'].includes(issue.errorType)) return false;
  return progress === 'all' || repairStage(issue) === progress;
}

export const repairLabels = {
  'zh-CN': {
    title: '修复进度', all: '全部', pending: '待排查', repairing: '修复中', verification: '待验证', resolved: '已验证',
    start: '开始修复', save: '保存修复记录', saved: '修复记录已保存', saving: '保存中…',
    cause: '问题原因', summary: '修复摘要', commitSha: '关联提交（可选）', deployment: '部署记录', verificationNote: '验证结果',
    notes: '修复记录', optionalPr: 'PR 链接（可选）', fixedRelease: '修复版本', verifiedRelease: '验证版本',
    fixed: '代码已修复，待验证', verified: '确认验证通过', firstRelease: '首次出现版本', lastRelease: '最近出现版本',
    hint: '代码修复完成不代表已部署或已恢复。请记录部署位置和验证结果，再确认验证通过。',
    pendingHint: '尚无本轮修复完成记录，可复制错误报告交给 AI 排查。',
    repairingHint: '正在处理问题。持续上报仍会计数，完成代码修复后再登记修复版本。',
    verificationHint: '代码已修复，等待部署及验证；此状态不代表线上已恢复。',
    resolvedHint: '已登记验证通过；后续修复版本或更新版本再次上报时会重开问题。',
    oldRelease: '旧版本仍在上报，不代表新版本验证失败。', search: '搜索错误信息或请求路径…',
    requiredFixed: '请填写修复版本。', requiredVerified: '请填写验证版本。', archiveHint: '本轮验证通过后才能归档。',
    updated: '记录更新于', clearMetric: '清除类型筛选', copy: '复制给 AI',
    deploymentPlaceholder: '例如：测试环境，版本 1.2.0，部署时间', verificationPlaceholder: '例如：复现步骤、测试结果、观察时间；尚未验证请留空'
  },
  'en-US': {
    title: 'Repair progress', all: 'All', pending: 'Needs investigation', repairing: 'Repairing', verification: 'Awaiting verification', resolved: 'Verified',
    start: 'Start repair', save: 'Save repair record', saved: 'Repair record saved', saving: 'Saving…',
    cause: 'Root cause', summary: 'Repair summary', commitSha: 'Commit (optional)', deployment: 'Deployment record', verificationNote: 'Verification result',
    notes: 'Repair record', optionalPr: 'PR link (optional)', fixedRelease: 'Fixed release', verifiedRelease: 'Verified release',
    fixed: 'Code fixed, verify next', verified: 'Confirm verification passed', firstRelease: 'First seen release', lastRelease: 'Last seen release',
    hint: 'A code fix does not prove deployment or recovery. Record deployment and verification results before confirming.',
    pendingHint: 'No completed fix recorded for this round. Copy the report for your AI to investigate.',
    repairingHint: 'Repair is in progress. New events remain counted; record the fixed release when code is ready.',
    verificationHint: 'Code is fixed and awaiting deployment and verification. Recovery is not yet confirmed.',
    resolvedHint: 'Verification has been recorded. An occurrence in the fixed or a newer release reopens the issue.',
    oldRelease: 'Old releases are still reporting. This does not mean the new release failed verification.', search: 'Search error messages or request paths…',
    requiredFixed: 'Fixed release is required.', requiredVerified: 'Verified release is required.', archiveHint: 'Verify this repair round before archiving.',
    updated: 'Record updated', clearMetric: 'Clear type filter', copy: 'Copy for AI',
    deploymentPlaceholder: 'Environment, deployed version and time', verificationPlaceholder: 'Reproduction steps, test result and observation period; leave empty if unverified'
  }
};
