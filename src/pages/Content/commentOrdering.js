export const normalizeSortOrder = value => ['api', 'likes'].includes(value) ? value : 'reading';
const reviewOf = entry => entry?.review || entry || {};
export const getAuthorKey = entry => {
  const author = reviewOf(entry).author || {};
  const id = author.userVid ?? author.vid ?? author.uid;
  if (id !== undefined && id !== null && String(id)) return `id:${id}`;
  return author.name ? `name:${author.name}` : 'unknown';
};
export const getAuthorOptions = entries => {
  const options = new Map();
  for (const entry of entries) {
    const key = getAuthorKey(entry);
    if (!options.has(key)) options.set(key, { key, name: String(reviewOf(entry).author?.name || '未知作者'), count: 0 });
    options.get(key).count++;
  }
  const duplicateNames = new Map();
  options.forEach(option => duplicateNames.set(option.name, (duplicateNames.get(option.name) || 0) + 1));
  return [...options.values()].map(option => ({ ...option,
    label: `${option.name}${duplicateNames.get(option.name) > 1 ? `（${option.key}）` : ''} · ${option.count} 条`,
  }));
};
export const getLoadedLikesCount = entry => {
  const value = entry?.likesCount ?? reviewOf(entry).likesCount;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
export const orderCommentRows = (rows, order) => {
  const result = [...rows];
  if (order === 'api') return result;
  if (order === 'likes') return result.sort((a, b) => {
    const left = getLoadedLikesCount(a.entry), right = getLoadedLikesCount(b.entry);
    return left === null ? right === null ? a.index - b.index : 1
      : right === null ? -1 : right - left || a.index - b.index;
  });
  return result.sort((a, b) => a.start - b.start || a.index - b.index);
};
