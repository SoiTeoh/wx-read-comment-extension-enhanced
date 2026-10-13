import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  favoriteEntryKey,
  isFavorite,
  subscribeFavorite,
  initializeFavorites,
  saveOrRemoveFavorite,
  favoriteErrorText,
} from './favorites';
export default function FavoriteAction({ entry }) {
  const key = favoriteEntryKey(entry),
    subscribe = useCallback(
      (listener) => subscribeFavorite(key, listener),
      [key]
    );
  const saved = useSyncExternalStore(subscribe, () => isFavorite(key));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    busyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void initializeFavorites().catch((error) => {
      if (alive) setMessage(favoriteErrorText(error));
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <button
        type="button"
        data-favorite-action="toggle"
        disabled={busy}
        aria-pressed={saved}
        onClick={async (event) => {
          event.stopPropagation();
          if (busyRef.current) return;
          busyRef.current = true;
          const parent = event.currentTarget.parentElement;
          setBusy(true);
          try {
            const result = await saveOrRemoveFavorite(entry, parent);
            setMessage(result ? '已保存到本地' : '已取消收藏');
          } catch (error) {
            setMessage(favoriteErrorText(error));
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }}
      >
        {saved ? '★ 已收藏' : '☆ 收藏'}
      </button>
      <span className="wxrc_favorite_status" role="status">
        {message}
      </span>
    </>
  );
}
