/**
 * V2.0 Phase 3.2: Prompt token 估算与截断工具
 *
 * 估算策略：中文约 1.5 token/字，英文约 0.75 token/词（即约 4 chars/token）
 * 截断优先级（从低到高，低优先级先截断）：
 *   1. 行为洞察（behaviorContext + behavior insights）
 *   2. 7日历史摘要
 *   3. 能力指令段
 *   4. few-shot 示例
 *   5. 保留：profile + today summary + restrictions + roleIntro + tonePrompt
 */

/** 粗略估算文本的 token 数（中英混合场景） */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  // 统计中日韩字符数
  const cjkChars = (
    text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []
  ).length;
  // 非 CJK 部分按英文估算
  const nonCjkLength = text.length - cjkChars;

  // CJK: ~1.5 token/字; 英文: ~1 token / 4 chars
  return Math.ceil(cjkChars * 1.5 + nonCjkLength / 4);
}

/**
 * 按 section 标记截断 prompt，确保不超过 token 上限。
 *
 * prompt 中用【...】标记 section，截断策略按优先级从低到高移除整个 section。
 * 返回截断后的 prompt。
 */
export function truncateToTokenBudget(
  prompt: string,
  maxTokens: number,
): string {
  if (estimateTokenCount(prompt) <= maxTokens) {
    return prompt;
  }

  // 按优先级从低到高，依次尝试移除的 section 关键字
  const removableSections = [
    // 优先级最低：行为洞察
    ['行为洞察', 'Behavior Insights', '行動分析'],
    // 7日历史
    ['最近 7 天平均', 'Recent 7 Days', '最近7日間'],
    // 能力指令
    ['V1.6 能力', 'V1.6 Capabilities', 'V1.6 機能'],
    // few-shot（示例段没有【】标记，用特殊处理）
  ];

  let result = prompt;

  // 先移除 behaviorContext（没有【】标记的行为上下文段，通常在末尾 tonePrompt 之前）
  // behaviorContext 是直接拼接的字符串，不好精确定位，跳过

  for (const sectionKeys of removableSections) {
    if (estimateTokenCount(result) <= maxTokens) break;
    result = removeSectionByKeys(result, sectionKeys);
  }

  // 如果还超，移除 few-shot 示例（在 "示例："/"Example:"/"例：" 和下一个【之间）
  if (estimateTokenCount(result) > maxTokens) {
    result = result.replace(/(示例：|Example:|例：)[\s\S]*?(?=\n【)/, '');
  }

  // 最后兜底：硬截断（保留前面的内容）
  if (estimateTokenCount(result) > maxTokens) {
    // 按字符粗略截断，保留约 maxTokens 对应的字符数
    const approxChars = Math.floor(maxTokens * 2.5); // 保守估计
    result = result.slice(0, approxChars) + '\n...(truncated for token safety)';
  }

  return result;
}

/** 移除 prompt 中以【key】开头的整个 section（到下一个【或结尾） */
function removeSectionByKeys(prompt: string, keys: string[]): string {
  for (const key of keys) {
    const marker = `【${key}】`;
    const startIdx = prompt.indexOf(marker);
    if (startIdx === -1) continue;

    // 找到下一个【的位置（即下一个 section 开始）
    const nextSectionIdx = prompt.indexOf('\n【', startIdx + marker.length);
    const endIdx = nextSectionIdx !== -1 ? nextSectionIdx : prompt.length;

    // 移除该 section（包括前面的换行）
    const removeStart =
      startIdx > 0 && prompt[startIdx - 1] === '\n' ? startIdx - 1 : startIdx;
    return prompt.slice(0, removeStart) + prompt.slice(endIdx);
  }
  return prompt;
}
