'use strict';

// 智谱 GLM Coding Plan 用量采集器
// 接口: GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
// 认证: Authorization: <API_KEY> (不加 Bearer 前缀)
// 返回 5 小时滚动窗口 + 每周窗口的已用百分比

const {
  clampPct,
  failedWindows,
  fetchJson,
  isoBeijing,
} = require('../lib/common.cjs');

async function collectZhipu(config = {}) {
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows('智谱', '未启用', fetchedAt), disabled: true };
  }
  const envName = String(config.apiKeyEnv || 'ZHIPU_API_KEY');
  const key = String(process.env[envName] || '').trim();
  if (!key) return failedWindows('智谱', `没有设置环境变量 ${envName}`, fetchedAt);
  try {
    const payload = await fetchJson('https://open.bigmodel.cn/api/monitor/usage/quota/limit', {
      headers: { Authorization: key, 'Content-Type': 'application/json' },
    });
    if (!payload || !payload.success || !payload.data) {
      throw new Error(payload && payload.msg ? payload.msg : '响应缺少 data');
    }
    const limits = Array.isArray(payload.data.limits) ? payload.data.limits : [];
    // 只取 TOKENS_LIMIT（5小时/每周 token 限额），忽略 TIME_LIMIT（MCP 次数）
    const tokenLimits = limits.filter((item) => item && item.type === 'TOKENS_LIMIT');
    // 无 nextResetTime 的为 5 小时滚动窗口，强制放第一位；其余按重置时间升序
    tokenLimits.sort((a, b) => {
      const aHas = a.nextResetTime != null;
      const bHas = b.nextResetTime != null;
      if (aHas !== bHas) return aHas ? 1 : -1;
      return (a.nextResetTime || 0) - (b.nextResetTime || 0);
    });
    const windows = [];
    if (tokenLimits[0]) {
      windows.push({
        name: '5小时',
        usedPct: clampPct(tokenLimits[0].percentage || 0),
        resetAt: tokenLimits[0].nextResetTime ? isoBeijing(tokenLimits[0].nextResetTime) : null,
      });
    }
    if (tokenLimits[1]) {
      windows.push({
        name: '每周',
        usedPct: clampPct(tokenLimits[1].percentage || 0),
        resetAt: tokenLimits[1].nextResetTime ? isoBeijing(tokenLimits[1].nextResetTime) : null,
      });
    }
    if (windows.length === 0) {
      throw new Error('没有 TOKENS_LIMIT 数据');
    }
    return {
      ok: true,
      label: '智谱',
      windows,
      fetchedAt,
      error: null,
    };
  } catch (error) {
    return failedWindows('智谱', error, fetchedAt);
  }
}

module.exports = { collectZhipu };
