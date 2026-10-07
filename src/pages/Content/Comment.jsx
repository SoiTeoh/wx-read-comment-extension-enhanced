import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFormattedDate, getReview } from './utils';

const collapsedClass = 'comment-item-abstract one-line';
const expandedClass = 'comment-item-abstract';

export const matchesCommentFilter = (entry, mapped, query, mappingFilter) => {
  if (mappingFilter === 'mapped' && !mapped) return false;
  if (mappingFilter === 'unmapped' && mapped) return false;
  const review = getReview(entry);
  const text = [review.content, review.abstract, review.author?.name]
    .map((value) => String(value || '').replace(/<[^>]*>/g, ' '))
    .join(' ').toLocaleLowerCase();
  return !query.trim() || text.includes(query.trim().toLocaleLowerCase());
};

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
  const {
    list = [], chapterName = '', loadStatus = 'loading',
    onReload, reviewSync, settings, onSettingChange,
  } = props;
  const [expandedReviewIds, setExpandedReviewIds] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [mappingFilter, setMappingFilter] = useState('all');
  const commentData = list;

  useEffect(() => {
    setExpandedReviewIds(new Set());
  }, [list]);

  useEffect(() => {
    setQuery('');
    setMappingFilter('all');
  }, [reviewSync?.chapterUid]);

  const displayedComments = useMemo(() => {
    const indexed = commentData.map((entry, index) => ({
        entry,
        index,
        start: getMappedRangeStart(entry, index, reviewSync),
      })).filter(({ entry, start }) => matchesCommentFilter(entry, Number.isFinite(start), query, mappingFilter));
    return settings?.sortOrder === 'api'
      ? indexed
      : indexed.sort((a, b) => a.start - b.start || a.index - b.index);
  }, [commentData, reviewSync, settings?.sortOrder, query, mappingFilter]);

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

  const emptyTip = loadStatus === 'loading'
    ? <p className="wxrc_empty_state" role="status">正在加载公开评论…</p>
    : loadStatus === 'error'
    ? (
      <div className="wxrc_empty_state" role="alert">
        <p>公开评论加载失败。</p>
        <button className="wxrc_empty_retry" type="button" onClick={onReload}>重试</button>
      </div>
    )
    : <p className="wxrc_empty_state">本章暂无公开评论。</p>;

  const firstReview = commentData[0] && getReview(commentData[0]);
  const chapterTitle =
    chapterName || firstReview?.chapterName || firstReview?.chapterTitle || '当前章节';

  const commentList = (
    <div className="wxrc_comment_list" data-density={settings?.commentDensity === 'compact' ? 'compact' : 'comfortable'}>
      <div className="comment-header">
        <div className="wxrc_project_link">
          <a
            href="https://github.com/SoiTeoh/wx-read-comment-extension-enhanced"
            target="_blank"
            rel="noreferrer"
          >
            项目说明
          </a>
          <button
            className="wxrc_sidebar_close"
            type="button"
            onClick={() => onSettingChange?.('showSidebar', false)}
            aria-label="关闭右侧评论栏"
          >
            关闭侧栏
          </button>
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
        <div className="wxrc_settings wxrc_browse_controls" role="group" aria-label="评论浏览">
          <label>搜索评论、引用或作者
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label>定位状态
            <select value={mappingFilter} onChange={(event) => setMappingFilter(event.target.value)}>
              <option value="all">全部评论</option>
              <option value="mapped">可定位</option>
              <option value="unmapped">暂不可定位</option>
            </select>
          </label>
          <label>显示密度
            <select value={settings?.commentDensity === 'compact' ? 'compact' : 'comfortable'} onChange={(event) => onSettingChange?.('commentDensity', event.target.value)}>
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </select>
          </label>
          <button type="button" disabled={!query && mappingFilter === 'all'} onClick={() => { setQuery(''); setMappingFilter('all'); }}>清除筛选</button>
        </div>
        <p className="wxrc_settings_description" role="status">显示 {displayedComments.length} / {commentData.length} 条；筛选仅作用于侧栏。</p>
      </div>
      {commentData.length === 0 && emptyTip}
      {commentData.length > 0 && displayedComments.length === 0 && <p className="wxrc_empty_state">没有符合筛选条件的评论。清除筛选可查看全部已加载评论。</p>}
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
              {mapped ? (
                <button
                  className="wxrc_comment_mapping_status wxrc_jump_to_text"
                  type="button"
                  aria-label={`定位正文：${author.name || '公开评论'}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    reviewSync.onReviewClick(reviewId);
                  }}
                >
                  定位正文
                </button>
              ) : (
                <span className="wxrc_comment_mapping_status">暂不可定位</span>
              )}
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleAbstract(event);
                  }
                }}
                data-review-id={reviewId}
                role="button"
                tabIndex={0}
                aria-expanded={expandedReviewIds.has(reviewId)}
                aria-label="展开或收起评论引用原文"
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
