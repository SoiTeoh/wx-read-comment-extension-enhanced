import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFormattedDate, getReview } from './utils';

const collapsedClass = 'comment-item-abstract one-line';
const expandedClass = 'comment-item-abstract';

const getReviewId = (entry, index) => {
  const review = getReview(entry);
  return String(review.reviewId || entry.reviewId || index);
};

const getMappedRangeStart = (entry, index, reviewSync) => {
  const reviewId = getReviewId(entry, index);
  if (!reviewSync?.mappedReviewIds?.has(reviewId)) return Infinity;
  const range = getReview(entry).range || entry.range || '';
  const match = String(range).match(/^(\d+)\s*-\s*(\d+)$/);
  return match && Number(match[2]) > Number(match[1])
    ? Number(match[1])
    : Infinity;
};

const Comment = (props) => {
  const { list = [], width, isDark, onReload, reviewSync, settings, onSettingChange } = props;
  const githubUrl = `https://636c-cloud1-5g5eyjtze161c202-1319072486.tcb.qcloud.la/dev/github-${
    isDark ? 'white' : 'black'
  }.png`;
  const [expandedReviewIds, setExpandedReviewIds] = useState(() => new Set());
  const commentData = list;

  useEffect(() => {
    setExpandedReviewIds(new Set());
  }, [list]);

  const displayedComments = useMemo(() => {
    const indexed = commentData.map((entry, index) => ({
        entry,
        index,
        start: getMappedRangeStart(entry, index, reviewSync),
      }));
    return settings?.sortOrder === 'api'
      ? indexed
      : indexed.sort((a, b) => a.start - b.start || a.index - b.index);
  }, [commentData, reviewSync, settings?.sortOrder]);

  const toggleAbstract = useCallback((event) => {
    event.stopPropagation();
    const reviewId = event.currentTarget.dataset.reviewId;
    setExpandedReviewIds((current) => {
      const next = new Set(current);
      if (next.has(reviewId)) next.delete(reviewId);
      else next.add(reviewId);
      return next;
    });
  }, []);

  const emptyTip = <h1 onClick={onReload}>点击刷新评论数据</h1>;

  const firstReview = commentData[0] && getReview(commentData[0]);
  const chapterTitle =
    firstReview?.chapterName || firstReview?.chapterTitle || '当前章节';

  const commentList = (
    <div style={{ width: width - 40 }}>
      <div className="comment-header">
        <div className="github-bar">
          <a
            href="https://github.com/my19940202/wx-read-comment-extension"
            target="_blank"
            rel="noreferrer"
          >
            开源不易，求 star 支持
            <img src={githubUrl} alt="GitHub" />
          </a>
        </div>
        <h1>
          {chapterTitle} · 已加载 {commentData.length} 条公开评论
        </h1>
        <div className="wxrc_settings" role="group" aria-label="公开评论设置">
          <label>
            <input
              type="checkbox"
              checked={settings?.followReadingPosition !== false}
              onChange={(event) => onSettingChange?.('followReadingPosition', event.target.checked)}
            />
            跟随阅读位置
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings?.showPublicUnderlines !== false}
              onChange={(event) => onSettingChange?.('showPublicUnderlines', event.target.checked)}
            />
            显示可点击评论划线
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings?.showSidebar !== false}
              onChange={(event) => onSettingChange?.('showSidebar', event.target.checked)}
            />
            显示右侧评论栏
          </label>
          <label>
            默认排序
            <select
              aria-label="右侧评论排序"
              value={settings?.sortOrder === 'api' ? 'api' : 'reading'}
              onChange={(event) => onSettingChange?.('sortOrder', event.target.value)}
            >
              <option value="reading">阅读顺序</option>
              <option value="api">接口默认</option>
            </select>
          </label>
        </div>
        <p className="wxrc_settings_description">
          仅展示接口返回的公开评论和公开想法。带有特殊样式的划线可点击查看公开想法。
          微信读书原生划线会保持不变，但原生划线不一定有公开评论，因此部分划线无法点击。
        </p>
      </div>
      {commentData.length === 0 && emptyTip}
      {displayedComments.map(({ entry, index }) => {
        const item = getReview(entry);
        const reviewId = getReviewId(entry, index);
        const rangeKey = reviewSync?.reviewRangeKeys?.get(reviewId) || '';
        const mapped = Boolean(
          rangeKey && reviewSync?.mappedReviewIds?.has(reviewId)
        );
        const rangeReviewCount =
          reviewSync?.rangeReviewCounts?.get(rangeKey) || 1;
        const author = item.author || {};
        const createTime = item.createTime
          ? getFormattedDate(item.createTime * 1000)
          : '';
        const abstract =
          '点击展开评论引用原文:&nbsp;' +
          String(item.abstract || '').replace(/\n/g, '<br/>');
        return (
          <div
            className={`comment-item ${
              mapped ? 'wxrc_comment_mapped' : 'wxrc_comment_unmapped'
            }`}
            key={reviewId}
            data-review-id={reviewId}
            data-range-key={rangeKey || undefined}
            onClick={() => {
              if (mapped) reviewSync.onReviewClick(reviewId);
            }}
            title={mapped ? '点击定位到正文' : '该评论暂时无法定位到正文'}
          >
            <div className="comment-item-title">
              <img className="avatar" src={author.avatar} alt="" />
              <span className="name">{author.name}</span>
              <span className="time">{createTime}</span>
              <span className="wxrc_comment_mapping_status">
                {mapped ? '可定位' : '暂不可定位'}
              </span>
              {mapped && rangeReviewCount > 1 && (
                <span className="wxrc_comment_same_range">
                  同段还有 {rangeReviewCount - 1} 条想法
                </span>
              )}
            </div>
            <div
              className="comment-item-content"
              dangerouslySetInnerHTML={{ __html: item.content || '' }}
            />
            {item.abstract && (
              <div
                className={expandedReviewIds.has(reviewId) ? expandedClass : collapsedClass}
                onClick={toggleAbstract}
                data-review-id={reviewId}
                dangerouslySetInnerHTML={{ __html: abstract }}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="comment-react-wrapper">
      {commentList}
    </div>
  );
};

export default Comment;
