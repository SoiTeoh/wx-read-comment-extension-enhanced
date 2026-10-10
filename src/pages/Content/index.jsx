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
  resolveReaderMode,
} from './utils';
import './content.styles.css';
import {
  clearPublicReviewState,
  getPublicReviewSyncProps,
  initializePublicReviewUnderlines,
  invalidatePublicReviewLayout,
  probePublicReviewCompatibility,
  renderPublicReviewUnderlines,
  setFollowReadingPosition,
  setPublicUnderlinesVisible,
  setSidebarVisible,
  setPublicReviewEnabled,
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

const renderComments = (root, list, chapterName, loadStatus, onReload, reviewSync, settings, onSettingChange) => {
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

const start = async (session) => {
  let root, wrapper, syncTimer;
  let scheduledSyncForce = false, syncInFlight = false, syncAgain = false, syncAgainForce = false;
  const live = () => session.active && !document.querySelector('.readerControls_item.isHorizontalReader');
  const stillVertical = async () => live() && await resolveReaderMode() === 'vertical' && live();
  const onDispose = cleanup => session.cleanups.push(cleanup);
  const abortController = new AbortController();
  onDispose(() => {
    abortController.abort();
    window.clearTimeout(syncTimer);
    root?.unmount();
    wrapper?.remove();
    document.body.classList.remove('wxrc_sidebar_visible');
  });
  const appDom = document.getElementById('app');

  let settings = await loadSettings();
  if (!live()) return;
  setPublicReviewEnabled(true);
  setFollowReadingPosition(settings.followReadingPosition);
  setPublicUnderlinesVisible(settings.showPublicUnderlines);
  wrapper = document.createElement('div');
  wrapper.className = 'chrex-comment-wrapper';
  (appDom || document.body).append(wrapper);
  const sidebarLauncher = document.createElement('button');
  sidebarLauncher.type = 'button';
  sidebarLauncher.className = 'wxrc_sidebar_launcher';
  sidebarLauncher.textContent = '公开评论';
  sidebarLauncher.title = '显示右侧评论栏';
  document.body.appendChild(sidebarLauncher);
  onDispose(() => sidebarLauncher.remove());
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
  let remapRequested = false;
  let reviewSync = getPublicReviewSyncProps();
  const onSettingChange = (key, value) => {
    if (!live()) return;
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
    live() && renderComments(
      root,
      latestComments,
      currentChapterName,
      loadStatus,
      () => readyForSync ? scheduleSync(true) : window.location.reload(),
      { ...reviewSync, onRetryCompatibility: () => {
        remapRequested = true;
        if (readyForSync) scheduleSync();
        else window.location.reload();
      } },
      settings,
      onSettingChange
    );
  renderLatestComments();
  initializePublicReviewUnderlines(() => {
    if (!live()) return;
    reviewSync = getPublicReviewSyncProps();
    renderLatestComments();
    remapRequested = true;
    scheduleSync();
  });

  await probePublicReviewCompatibility();
  if (!live()) return;
  reviewSync = getPublicReviewSyncProps();
  renderLatestComments();

  const book = await resolveBookId();
  if (!live()) return;
  if (!book) {
    phase2Log('bookId resolution failed');
    loadStatus = 'error';
    renderLatestComments();
    return;
  }
  phase2Log('bookId resolved', book);
  session.bookId = book.value;
  wrapper.dataset.bookId = book.value;

  let catalog;
  try {
    catalog = await getChapterCatalog(book.value);
    if (!live()) return;
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

  const mapCurrentReviews = async (chapter) => {
    if (!(await stillVertical())) return;
    const stats = await renderPublicReviewUnderlines(latestComments, chapter.chapterUid);
    const current = await resolveCurrentChapter(catalog.chapters);
    if (!live() || stats?.staleDiscarded || current?.chapterUid !== chapter.chapterUid) return;
    wrapper.dataset.chapterUid = chapter.chapterUid;
    wrapper.dataset.layoutVersion = String(stats.layoutVersion ?? '');
    wrapper.dataset.mappedRangeCount = String(stats.mappedRangeCount);
    wrapper.dataset.failedRangeCount = String(stats.failedRangeCount);
    wrapper.dataset.mappingCallCounts = JSON.stringify(stats.mappingCallCounts || null);
    reviewSync = getPublicReviewSyncProps();
    wrapper.dataset.compatibility = reviewSync.compatibility?.code || '';
    renderLatestComments();
  };

  const syncCurrentChapter = async (force = false) => {
    if (!live()) return;
    if (syncInFlight) {
      syncAgain = true;
      syncAgainForce = syncAgainForce || force;
      return;
    }
    syncInFlight = true;
    try {
      if (!(await stillVertical())) return;
      const chapter = await resolveCurrentChapter(catalog.chapters);
      if (!live()) return;
      if (!chapter) {
        phase2Log('current chapterUid was not resolved');
        loadStatus = 'error';
        renderLatestComments();
        return;
      }
      const reuseReviews = !force && chapter.chapterUid === activeChapterUid &&
        remapRequested && loadStatus === 'ready';
      if (!force && chapter.chapterUid === activeChapterUid && !reuseReviews) {
        return;
      }
      remapRequested = false;
      if (reuseReviews) {
        await mapCurrentReviews(chapter);
        return;
      }

      if (chapter.chapterUid !== activeChapterUid) {
        clearPublicReviewState(chapter.chapterUid);
        wrapper.dataset.chapterUid = chapter.chapterUid;
        for (const key of ['layoutVersion', 'reviewPageCount', 'reviewCount', 'chapterTotalCount',
          'paginationStoppedReason', 'mappedRangeCount', 'failedRangeCount', 'mappingCallCounts', 'compatibility']) {
          delete wrapper.dataset[key];
        }
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
      }, async () => await stillVertical() && activeChapterUid === chapter.chapterUid &&
        (await resolveCurrentChapter(catalog.chapters))?.chapterUid === chapter.chapterUid,
      abortController.signal);
      if (!(await stillVertical())) return;
      const filtered = filterReviewsByChapterUid(response, chapter.chapterUid);
      const allReviews = response.reviews || [];
      const missingChapterUid = allReviews.filter(
        (item) => !getReviewChapterUid(item)
      );

      const currentAfterRequest = await resolveCurrentChapter(catalog.chapters);
      if (!live() || currentAfterRequest?.chapterUid !== chapter.chapterUid) {
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
      await mapCurrentReviews(chapter);
    } catch (error) {
      if (!live()) return;
      phase2Log('chapter comment sync failed', String(error));
      loadStatus = 'error';
      renderLatestComments();
    } finally {
      syncInFlight = false;
      if (live() && syncAgain) {
        syncAgain = false;
        const rerunForce = syncAgainForce;
        syncAgainForce = false;
        void syncCurrentChapter(rerunForce);
      }
    }
  };

  function scheduleSync(force = false) {
    if (!live() || !readyForSync) return;
    scheduledSyncForce = scheduledSyncForce || force;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      const runForce = scheduledSyncForce;
      scheduledSyncForce = false;
      void syncCurrentChapter(runForce);
    }, 180);
  }

  await syncCurrentChapter();
  if (!live()) return;

  let lastBodyClassName = document.body.className;
  const observer = new MutationObserver((mutations) => {
    if (!live()) return;
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
  onDispose(() => observer.disconnect());
  const schedule = () => scheduleSync();
  for (const event of ['popstate', 'hashchange', 'scroll']) {
    window.addEventListener(event, schedule, event === 'scroll');
    onDispose(() => window.removeEventListener(event, schedule, event === 'scroll'));
  }
  const interval = window.setInterval(schedule, 1000);
  onDispose(() => window.clearInterval(interval));
};

const manageReadingMode = () => {
  let session = null;
  let checking = false;
  const disposeSession = () => {
    if (!session) return;
    session.active = false;
    setPublicReviewEnabled(false);
    for (const cleanup of session.cleanups.splice(0).reverse()) cleanup();
    session = null;
  };
  const applyMode = mode => {
    if (mode !== 'vertical') {
      disposeSession();
      return;
    }
    if (session) return;
    session = { active: true, cleanups: [] };
    void start(session).catch(error => console.warn('[WxReadComments] initialization failed', String(error)));
  };
  const check = async () => {
    // Native mode controls let us tear down synchronously on a DOM mode switch.
    if (document.querySelector('.readerControls_item.isHorizontalReader')) applyMode('horizontal');
    if (checking) return;
    checking = true;
    try { applyMode(await resolveReaderMode()); } finally { checking = false; }
  };
  setPublicReviewEnabled(false);
  window.addEventListener('message', event => {
    if (event.source === window && event.data?.source === 'WXRC_PAGE' && event.data.type === 'READER_MODE_CHANGED') {
      if (session?.bookId && event.data.bookId && session.bookId !== event.data.bookId) disposeSession();
      void check();
    }
  });
  new MutationObserver(() => {
    if (session && document.querySelector('.readerControls_item.isHorizontalReader')) applyMode('horizontal');
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.setInterval(() => void check(), 1000);
  void check();
};

if (document.readyState === 'complete') {
  manageReadingMode();
} else {
  window.addEventListener('load', manageReadingMode, { once: true });
}
