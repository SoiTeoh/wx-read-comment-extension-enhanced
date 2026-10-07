import React from 'react';
import { createRoot } from 'react-dom/client';
import Comment from './Comment';
import {
  filterReviewsByChapterUid,
  getChapterCatalog,
  getAllCommentData,
  getReviewChapterUid,
  phase2Log,
  resolveBookId,
  resolveCurrentChapter,
} from './utils';
import './content.styles.css';
import {
  clearPublicReviewState,
  getPublicReviewSyncProps,
  initializePublicReviewUnderlines,
  invalidatePublicReviewLayout,
  renderPublicReviewUnderlines,
  setFollowReadingPosition,
  setPublicUnderlinesVisible,
  setSidebarVisible,
} from './publicReviewUnderlines';

const SETTINGS_KEY = 'wxrc_phase6_settings';
const DEFAULT_SETTINGS = {
  followReadingPosition: true,
  showPublicUnderlines: true,
  showSidebar: true,
  sortOrder: 'reading',
  commentDensity: 'comfortable',
};

const loadSettings = async () => {
  try {
    const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    return {
      followReadingPosition: stored?.followReadingPosition !== false,
      showPublicUnderlines: stored?.showPublicUnderlines !== false,
      showSidebar: stored?.showSidebar !== false,
      sortOrder: stored?.sortOrder === 'api' ? 'api' : 'reading',
      commentDensity: stored?.commentDensity === 'compact' ? 'compact' : 'comfortable',
    };
  } catch (error) {
    console.warn('[WxReadComments][Phase6] settings load failed', String(error));
    return { ...DEFAULT_SETTINGS };
  }
};

let root;
let wrapper;
let syncTimer;
let scheduledSyncForce = false;
let syncInFlight = false;
let syncAgain = false;
let syncAgainForce = false;

const renderComments = (list, chapterName, loadStatus, onReload, reviewSync, settings, onSettingChange) => {
  root.render(
    <Comment
      list={list}
      chapterName={chapterName}
      loadStatus={loadStatus}
      onReload={onReload}
      reviewSync={reviewSync}
      settings={settings}
      onSettingChange={onSettingChange}
    />
  );
};

const start = async () => {
  const appDom = document.getElementById('app');
  if (!appDom) {
    phase2Log('cannot start: #app was not found');
    return;
  }

  let settings = await loadSettings();
  setFollowReadingPosition(settings.followReadingPosition);
  setPublicUnderlinesVisible(settings.showPublicUnderlines);
  wrapper = document.createElement('div');
  wrapper.className = 'chrex-comment-wrapper';
  appDom.append(wrapper);
  const sidebarLauncher = document.createElement('button');
  sidebarLauncher.type = 'button';
  sidebarLauncher.className = 'wxrc_sidebar_launcher';
  sidebarLauncher.textContent = '公开评论';
  sidebarLauncher.title = '显示右侧评论栏';
  document.body.appendChild(sidebarLauncher);
  const applySidebarVisibility = () => {
    wrapper.hidden = !settings.showSidebar;
    sidebarLauncher.hidden = settings.showSidebar;
    document.body.classList.toggle('wxrc_sidebar_visible', settings.showSidebar);
    setSidebarVisible(settings.showSidebar);
  };
  applySidebarVisibility();
  root = createRoot(wrapper);
  let latestComments = [];
  let currentChapterName = '';
  let loadStatus = 'loading';
  let readyForSync = false;
  let reviewSync = getPublicReviewSyncProps();
  const onSettingChange = (key, value) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return;
    settings = {
      ...settings,
      [key]: key === 'sortOrder' ? (value === 'api' ? 'api' : 'reading')
        : key === 'commentDensity' ? (value === 'compact' ? 'compact' : 'comfortable') : Boolean(value),
    };
    setFollowReadingPosition(settings.followReadingPosition);
    setPublicUnderlinesVisible(settings.showPublicUnderlines);
    if (key === 'showSidebar') {
      applySidebarVisibility();
      invalidatePublicReviewLayout('sidebar-visibility-changed');
    }
    renderLatestComments();
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch((error) =>
      console.warn('[WxReadComments][Phase6] settings save failed', String(error))
    );
  };
  sidebarLauncher.addEventListener('click', () => onSettingChange('showSidebar', true));
  const renderLatestComments = () =>
    renderComments(
      latestComments,
      currentChapterName,
      loadStatus,
      () => readyForSync ? scheduleSync(true) : window.location.reload(),
      reviewSync,
      settings,
      onSettingChange
    );
  renderLatestComments();
  initializePublicReviewUnderlines(() => {
    reviewSync = getPublicReviewSyncProps();
    renderLatestComments();
    scheduleSync(true);
  });

  const book = await resolveBookId();
  if (!book) {
    phase2Log('bookId resolution failed');
    loadStatus = 'error';
    renderLatestComments();
    return;
  }
  phase2Log('bookId resolved', book);

  let catalog;
  try {
    catalog = await getChapterCatalog(book.value);
  } catch (error) {
    phase2Log('chapter catalog request failed', String(error));
    loadStatus = 'error';
    renderLatestComments();
    return;
  }
  readyForSync = true;
  phase2Log('chapter catalog loaded', {
    source: catalog.source,
    chapterCount: catalog.chapters.length,
  });

  let activeChapterUid = '';

  const syncCurrentChapter = async (force = false) => {
    if (syncInFlight) {
      syncAgain = true;
      syncAgainForce = syncAgainForce || force;
      return;
    }
    syncInFlight = true;
    try {
      const chapter = await resolveCurrentChapter(catalog.chapters);
      if (!chapter) {
        phase2Log('current chapterUid was not resolved');
        loadStatus = 'error';
        renderLatestComments();
        return;
      }
      if (!force && chapter.chapterUid === activeChapterUid) {
        return;
      }

      if (chapter.chapterUid !== activeChapterUid) {
        clearPublicReviewState(chapter.chapterUid);
        wrapper.dataset.chapterUid = chapter.chapterUid;
        delete wrapper.dataset.layoutVersion;
        latestComments = [];
        loadStatus = 'loading';
        reviewSync = getPublicReviewSyncProps();
        renderLatestComments();
      }
      activeChapterUid = chapter.chapterUid;
      currentChapterName = chapter.chapterName || '';
      if (force) {
        loadStatus = 'loading';
        renderLatestComments();
      }
      phase2Log('current chapter resolved', chapter);

      const response = await getAllCommentData({
        bookId: book.value,
        chapterUid: chapter.chapterUid,
        listType: 8,
      }, () => activeChapterUid === chapter.chapterUid);
      const filtered = filterReviewsByChapterUid(response, chapter.chapterUid);
      const allReviews = response.reviews || [];
      const missingChapterUid = allReviews.filter(
        (item) => !getReviewChapterUid(item)
      );

      const currentAfterRequest = await resolveCurrentChapter(catalog.chapters);
      if (currentAfterRequest?.chapterUid !== chapter.chapterUid) {
        phase2Log('discarded stale chapter review response', {
          requestChapterUid: chapter.chapterUid,
          currentChapterUid: currentAfterRequest?.chapterUid || '',
        });
        return;
      }

      wrapper.dataset.reviewPageCount = String(response.pageCount || 0);
      wrapper.dataset.reviewCount = String(filtered.length);
      wrapper.dataset.chapterTotalCount = String(response.chapterTotalCount ?? '');
      wrapper.dataset.paginationStoppedReason = response.paginationStoppedReason || '';

      const proof = {
        bookId: book.value,
        bookIdSource: book.source,
        chapterUid: chapter.chapterUid,
        chapterIdx: chapter.chapterIdx,
        chapterName: chapter.chapterName,
        chapterUidSource: chapter.source,
        responseReviewCount: allReviews.length,
        matchedReviewCount: filtered.length,
        rejectedReviewCount: allReviews.length - filtered.length,
        missingChapterUidCount: missingChapterUid.length,
        responseTotalCount: response.totalCount,
        hasMore: response.hasMore,
        synckey: response.synckey,
        chapterTotalCount: response.chapterTotalCount,
        pageCount: response.pageCount,
        paginationStoppedReason: response.paginationStoppedReason,
      };

      phase2Log('current chapter review filter proof', proof);

      latestComments = filtered;
      loadStatus = 'ready';
      reviewSync = getPublicReviewSyncProps();
      renderLatestComments();
      const underlineStats = await renderPublicReviewUnderlines(
        filtered,
        chapter.chapterUid
      );
      const currentAfterMapping = await resolveCurrentChapter(catalog.chapters);
      if (
        underlineStats?.staleDiscarded ||
        currentAfterMapping?.chapterUid !== chapter.chapterUid
      ) {
        phase2Log('discarded stale range mapping result', {
          requestChapterUid: chapter.chapterUid,
          currentChapterUid: currentAfterMapping?.chapterUid || '',
          layoutVersion: underlineStats?.layoutVersion ?? null,
        });
        return;
      }
      wrapper.dataset.chapterUid = chapter.chapterUid;
      wrapper.dataset.layoutVersion = String(underlineStats.layoutVersion);
      wrapper.dataset.mappedRangeCount = String(underlineStats.mappedRangeCount);
      wrapper.dataset.failedRangeCount = String(underlineStats.failedRangeCount);
      wrapper.dataset.mappingCallCounts = JSON.stringify(
        underlineStats.mappingCallCounts || null
      );
      reviewSync = getPublicReviewSyncProps();
      renderLatestComments();
    } catch (error) {
      phase2Log('chapter comment sync failed', String(error));
      loadStatus = 'error';
      renderLatestComments();
    } finally {
      syncInFlight = false;
      if (syncAgain) {
        syncAgain = false;
        const rerunForce = syncAgainForce;
        syncAgainForce = false;
        void syncCurrentChapter(rerunForce);
      }
    }
  };

  function scheduleSync(force = false) {
    scheduledSyncForce = scheduledSyncForce || force;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      const runForce = scheduledSyncForce;
      scheduledSyncForce = false;
      void syncCurrentChapter(runForce);
    }, 180);
  }

  await syncCurrentChapter();

  let lastBodyClassName = document.body.className;
  const observer = new MutationObserver((mutations) => {
    const bodyClassChanged = mutations.some(
      (mutation) =>
        mutation.type === 'attributes' &&
        mutation.target === document.body &&
        mutation.attributeName === 'class'
    );
    if (bodyClassChanged && document.body.className !== lastBodyClassName) {
      const previousFontClass = lastBodyClassName.match(/wr_reader_font_size_level_\d+/)?.[0];
      const currentFontClass = document.body.className.match(/wr_reader_font_size_level_\d+/)?.[0];
      lastBodyClassName = document.body.className;
      renderLatestComments();
      if (previousFontClass !== currentFontClass) {
        invalidatePublicReviewLayout('reader-font-size-changed');
      }
      return;
    }
    scheduleSync();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: [
      'class',
      'data-chapter-uid',
      'data-chapteruid',
      'aria-current',
    ],
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.addEventListener('popstate', () => scheduleSync());
  window.addEventListener('hashchange', () => scheduleSync());
  window.addEventListener('scroll', () => scheduleSync(), true);
  window.setInterval(() => scheduleSync(), 1000);
};

if (document.readyState === 'complete') {
  void start();
} else {
  window.addEventListener('load', () => void start(), { once: true });
}
