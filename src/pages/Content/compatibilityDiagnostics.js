/**
 * Build a sanitized compatibility diagnostic report for troubleshooting
 * without exposing account credentials, cookies, book IDs, or book text.
 */
export const buildDiagnosticReport = ({
  compatibility = null,
  reviewSync = null,
  interactionCapabilities = null,
  extensionVersion = 'unknown',
  userAgent = '',
  timestamp = new Date().toISOString(),
} = {}) => {
  const compat = compatibility || reviewSync?.compatibility || null;
  const mappingAvailable = compat?.mappingAvailable === true;
  const mappedCount =
    reviewSync?.mappedReviewIds instanceof Set
      ? reviewSync.mappedReviewIds.size
      : Number(reviewSync?.mappedCount) || 0;
  const reviewCount = Number(reviewSync?.totalReviewCount) || 0;

  return {
    extensionVersion: String(extensionVersion || 'unknown'),
    timestamp: String(timestamp),
    userAgent: String(userAgent || ''),
    mapping: {
      available: mappingAvailable,
      code: String(compat?.code || (mappingAvailable ? 'READY' : 'UNKNOWN')),
      missingMethods: Array.isArray(compat?.missingMethods)
        ? compat.missingMethods.map((m) => String(m))
        : [],
    },
    stats: {
      hasLayoutVersion: Number.isFinite(reviewSync?.layoutVersion),
      layoutVersion: Number.isFinite(reviewSync?.layoutVersion)
        ? reviewSync.layoutVersion
        : null,
      reviewCount,
      mappedReviewCount: mappedCount,
      mappedRangeCount:
        reviewSync?.rangeReviewCounts instanceof Map
          ? reviewSync.rangeReviewCounts.size
          : 0,
    },
    interactions: {
      likeAvailable: interactionCapabilities?.like === true,
      replyAvailable: interactionCapabilities?.reply === true,
      reason: String(interactionCapabilities?.reason || ''),
    },
  };
};

export const formatDiagnosticReport = (report) =>
  [
    '# 微信读书评论增强版 · 兼容性诊断报告（已脱敏）',
    `- 扩展版本: ${report.extensionVersion}`,
    `- 生成时间: ${report.timestamp}`,
    `- 浏览器: ${report.userAgent || 'unknown'}`,
    `- 正文映射: ${report.mapping.available ? '可用' : '不可用'} (${report.mapping.code})`,
    report.mapping.missingMethods.length
      ? `- 缺失方法: ${report.mapping.missingMethods.join(', ')}`
      : null,
    `- 布局版本: ${report.stats.layoutVersion ?? '无'}`,
    `- 评论统计: 总加载 ${report.stats.reviewCount} 条 / 已映射 ${report.stats.mappedReviewCount} 条 (${report.stats.mappedRangeCount} 处位置)`,
    `- 互动能力: 点赞=${report.interactions.likeAvailable ? '可用' : '不可用'}, 回复=${report.interactions.replyAvailable ? '可用' : '不可用'}${report.interactions.reason ? ` (${report.interactions.reason})` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
