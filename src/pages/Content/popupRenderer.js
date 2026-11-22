import { positionPopup } from './popupBadgeLayout';
import { createNativeTextToolbar } from './nativeTextToolbar';
import { appendReviewActions } from './reviewInteractions';
import { isLongComment, POPUP_PAGE_SIZE } from './commentBrowsing';
import { appendFavoriteButton, openFavorites } from './favorites';

export const POPUP_CLASS = 'wxrc_public_review_popup';
export const BADGE_CLASS = 'wxrc_public_review_badge';

const appendTextBlock = (parent, className, text) => {
  if (!text) return;
  const node = document.createElement('div');
  node.className = className;
  node.textContent = String(text);
  parent.appendChild(node);
};

/**
 * Create a controller for rendering and managing the public review popup lifecycle.
 */
export const createPopupController = ({
  sendRequest,
  popupBrowsingMemory,
}) => {
  let popupReturnFocus = null;
  let popupCleanups = [];
  let savePopupBrowsing = null;

  const removePopup = (restoreFocus = false) => {
    savePopupBrowsing?.();
    savePopupBrowsing = null;
    for (const cleanup of popupCleanups.splice(0)) cleanup();
    document.querySelectorAll(`.${POPUP_CLASS}`).forEach((node) => node.remove());
    const returnFocus = popupReturnFocus;
    popupReturnFocus = null;
    if (restoreFocus && returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
  };

  const showPopup = (event, reviews, group) => {
    removePopup();
    const trigger =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : event.currentTarget
        ? null
        : document.activeElement;
    popupReturnFocus =
      trigger instanceof HTMLElement &&
      trigger.matches(`.${BADGE_CLASS}, .wxrc_public_review_wrapper`)
        ? trigger
        : null;

    const popup = document.createElement('div');
    popup.className = POPUP_CLASS;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '公开评论');
    popup.setAttribute('aria-modal', 'false');

    const toolbar = document.createElement('div');
    toolbar.className = 'wxrc_public_review_popup_toolbar';
    const count = document.createElement('span');
    count.textContent = `${reviews.length} 条公开想法`;

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.setAttribute('aria-label', '关闭公开评论');
    close.addEventListener('click', () => removePopup(true));

    const favorites = document.createElement('button');
    favorites.type = 'button';
    favorites.textContent = '本地收藏';
    favorites.addEventListener('click', (e) => {
      e.stopPropagation();
      openFavorites(favorites);
    });

    toolbar.append(count, favorites, close);
    popup.appendChild(toolbar);

    const reposition = () => {
      if (!popup.isConnected) return;
      const rect = popup.getBoundingClientRect();
      const position = positionPopup(
        { x: event.clientX, y: event.clientY },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      );
      popup.style.left = `${position.left}px`;
      popup.style.top = `${position.top}px`;
    };

    if (group) {
      const operations = createNativeTextToolbar({
        popup,
        group,
        request: sendRequest,
        close: () => removePopup(),
        reposition,
      });
      popup.append(operations.toolbar, operations.quote, operations.status);
    }

    const memoryKey = group?.key;
    const browsing = popupBrowsingMemory.read(memoryKey);
    const items = document.createElement('div');
    items.className = 'wxrc_public_review_popup_list';

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'wxrc_popup_load_more';

    const progress = document.createElement('span');
    progress.className = 'wxrc_popup_progress';
    progress.setAttribute('role', 'status');

    popup.append(items, more, progress);

    let rendered = 0;
    const appendItem = (review, index) => {
      const item = document.createElement('div');
      item.className = 'wxrc_public_review_popup_item';

      const header = document.createElement('div');
      header.className = 'wxrc_public_review_popup_author';
      if (review.author?.avatar) {
        const avatar = document.createElement('img');
        avatar.src = review.author.avatar;
        avatar.alt = '';
        header.appendChild(avatar);
      }
      const name = document.createElement('span');
      name.textContent = review.author?.name || '微信读书用户';
      header.appendChild(name);
      item.appendChild(header);

      appendTextBlock(item, 'wxrc_public_review_popup_abstract', review.abstract);

      const content = document.createElement('div');
      content.className = 'wxrc_public_review_popup_content';
      content.textContent = String(review.content || '');
      item.appendChild(content);

      if (isLongComment(review.content)) {
        const id = String(review.reviewId || index);
        const expand = document.createElement('button');
        expand.type = 'button';
        expand.className = 'wxrc_comment_expand';
        const update = () => {
          const opened = browsing.expanded.has(id);
          content.classList.toggle('wxrc_comment_content_collapsed', !opened);
          expand.textContent = opened ? '收起全文' : '展开全文';
          expand.setAttribute('aria-expanded', String(opened));
        };
        expand.addEventListener('click', (e) => {
          e.stopPropagation();
          if (browsing.expanded.has(id)) browsing.expanded.delete(id);
          else browsing.expanded.add(id);
          update();
        });
        update();
        item.appendChild(expand);
      }

      popupCleanups.push(appendReviewActions(item, String(review.reviewId || '')));
      popupCleanups.push(
        appendFavoriteButton(item.querySelector('.wxrc_review_actions'), review)
      );
      items.appendChild(item);
    };

    const appendPage = (target) => {
      const end = Math.min(reviews.length, target);
      while (rendered < end) {
        appendItem(reviews[rendered], rendered);
        rendered += 1;
      }
      browsing.loaded = rendered;
      more.hidden = rendered === reviews.length;
      more.textContent = `加载更多想法（剩余 ${reviews.length - rendered} 条）`;
      progress.textContent =
        reviews.length > POPUP_PAGE_SIZE
          ? `已显示 ${rendered} / ${reviews.length} 条`
          : '';
    };

    appendPage(browsing.loaded);
    more.addEventListener('click', () => {
      const top = popup.scrollTop;
      const firstNewIndex = rendered;
      appendPage(rendered + POPUP_PAGE_SIZE);
      popup.scrollTop = top;
      if (more.hidden) {
        const firstNew = items.children[firstNewIndex];
        firstNew?.querySelector('button')?.focus({ preventScroll: true });
      }
    });

    document.body.appendChild(popup);
    const popupRect = popup.getBoundingClientRect();
    const position = positionPopup(
      { x: event.clientX, y: event.clientY },
      { width: popupRect.width, height: popupRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
    popup.scrollTop = browsing.scrollTop;

    savePopupBrowsing = () => {
      if (memoryKey) {
        popupBrowsingMemory.save(memoryKey, {
          ...browsing,
          scrollTop: popup.scrollTop,
        });
      }
    };
    close.focus({ preventScroll: true });
  };

  return {
    showPopup,
    removePopup,
  };
};
