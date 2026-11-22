const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(value, maximum));

export const positionPopup = (
  { x, y },
  { width, height },
  { width: viewportWidth, height: viewportHeight },
  margin = 12
) => {
  const right = x + margin;
  const left = x - width - margin;
  const below = y + margin;
  const above = y - height - margin;
  return {
    left: clamp(
      right + width <= viewportWidth - margin ? right : left,
      margin,
      Math.max(margin, viewportWidth - width - margin)
    ),
    top: clamp(
      below + height <= viewportHeight - margin ? below : above,
      margin,
      Math.max(margin, viewportHeight - height - margin)
    ),
  };
};

export const formatBadgeLabel = (count) =>
  count > 99 ? '99+' : String(count);

export const badgeWidthForCount = (count) =>
  Math.max(20, 10 + formatBadgeLabel(count).length * 7);

export const positionBadge = (
  rect,
  { width: canvasWidth, height: canvasHeight },
  { width: badgeWidth, height: badgeHeight },
  placed,
  gap = 3,
  options = {}
) => {
  const maxY = Math.max(0, canvasHeight - badgeHeight);
  const centerY = clamp(rect.y + rect.h / 2 - badgeHeight / 2, 0, maxY);
  const step = badgeHeight + gap;
  const free = (x, y) =>
    placed.every(
      (other) =>
        x + badgeWidth + gap <= other.x ||
        other.x + other.w + gap <= x ||
        y + badgeHeight + gap <= other.y ||
        other.y + other.h + gap <= y
    );

  const gutterGap = 10;
  const rightGutterWidth = Number(options?.rightGutterWidth) || 0;
  if (rightGutterWidth >= badgeWidth + gutterGap) {
    const gutterX = canvasWidth + gutterGap;
    for (let level = 0; level <= Math.ceil(canvasHeight / step); level += 1) {
      for (const direction of level === 0 ? [0] : [1, -1]) {
        const y = centerY + direction * level * step;
        if (y >= 0 && y <= maxY && free(gutterX, y)) {
          return { x: gutterX, y, w: badgeWidth, h: badgeHeight };
        }
      }
    }
    return { x: gutterX, y: centerY, w: badgeWidth, h: badgeHeight };
  }

  const maxX = Math.max(0, canvasWidth - badgeWidth);
  const preferredRightX = rect.x + rect.w + gap;
  const rightX = clamp(preferredRightX, 0, maxX);
  const leftX = clamp(rect.x - badgeWidth - gap, 0, maxX);
  const xOptions = preferredRightX <= maxX ? [rightX, leftX] : [leftX, rightX];

  for (const x of xOptions) {
    for (let level = 0; level <= Math.ceil(canvasHeight / step); level += 1) {
      for (const direction of level === 0 ? [0] : [1, -1]) {
        const y = centerY + direction * level * step;
        if (y >= 0 && y <= maxY && free(x, y)) {
          return { x, y, w: badgeWidth, h: badgeHeight };
        }
      }
    }
  }

  return { x: rightX, y: centerY, w: badgeWidth, h: badgeHeight };
};
