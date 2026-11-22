/**
 * Size classes of resources (FR-053, data-model "Size class rules"), using the longer side L and
 * the shorter side S in millimeters: icon L ≤ 25; small 25 < L ≤ 75; medium 75 < L ≤ 150;
 * a4 |S − 210| ≤ 5 and |L − 297| ≤ 5; largerThanA4 S > 215 or L > 302; large all other sizes
 * with L > 150; no dimensions → notApplicable. a4 is checked before large.
 */

/** Size classes from small to large, then "not applicable" (also the sort order). */
export const SIZE_CLASSES = Object.freeze(['icon', 'small', 'medium', 'large', 'a4', 'largerThanA4', 'notApplicable']);

/**
 * Returns the size class of a resource.
 * @param {number|null} widthMm Width in mm, or null.
 * @param {number|null} heightMm Height in mm, or null.
 * @returns {string} One of SIZE_CLASSES.
 */
export function sizeClass(widthMm, heightMm) {
  if (typeof widthMm !== 'number' || typeof heightMm !== 'number') return 'notApplicable';
  const L = Math.max(widthMm, heightMm);
  const S = Math.min(widthMm, heightMm);
  if (L <= 25) return 'icon';
  if (L <= 75) return 'small';
  if (L <= 150) return 'medium';
  if (Math.abs(S - 210) <= 5 && Math.abs(L - 297) <= 5) return 'a4';
  if (S > 215 || L > 302) return 'largerThanA4';
  return 'large';
}
