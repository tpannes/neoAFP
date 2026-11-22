/**
 * Layout of the continuous page view (FR-017): rows stacked from top to bottom, each row a page or
 * a sheet with front and back side by side (`columns: 2`). The size of a row is known only once it
 * is loaded; until then every row is assumed to be as large as the first one (`estimate`), and
 * `setSize` corrects it. Sizes are page units (1440 per inch), distances CSS pixels.
 *
 * Positions follow from the sizes, so a correction moves every row below it. `anchor` and
 * `scrollTopFor` keep the same spot in view across corrections and zoom changes.
 */

export class ScrollLayout {
  /**
   * Creates the layout.
   * @param {{count: number, estimate: {width: number, height: number}, columns?: number,
   *   columnGap?: number, extraHeight?: number, gap?: number, padding?: number}} options Number of
   *   rows, assumed size of one side of a row, sides per row, pixels between the sides, pixels
   *   below each row (captions), pixels between rows, and pixels around all rows.
   */
  constructor({ count, estimate, columns = 1, columnGap = 0, extraHeight = 0, gap = 16, padding = 16 }) {
    Object.assign(this, { count: Math.max(0, count), estimate, columns, columnGap, extraHeight, gap, padding });
    this.sizes = new Map();
    this.scale = 1;
    this.tops = new Float64Array(this.count + 1);
    this.dirty = true;
  }

  /**
   * Records the real size of a row.
   * @param {number} index Row index.
   * @param {{width: number, height: number}} size Size of one side in page units.
   * @returns {boolean} True when the size differs from the one assumed so far.
   */
  setSize(index, size) {
    const old = this.sizeOf(index);
    this.sizes.set(index, { width: size.width, height: size.height });
    const changed = old.width !== size.width || old.height !== size.height;
    if (changed) this.dirty = true;
    return changed;
  }

  /**
   * Returns the size of a row: its real size once known, the estimate before.
   * @param {number} index Row index.
   * @returns {{width: number, height: number}} Size of one side in page units.
   */
  sizeOf(index) {
    return this.sizes.get(index) ?? this.estimate;
  }

  /**
   * Sets the scale.
   * @param {number} scale CSS pixels per page unit.
   * @returns {void}
   */
  setScale(scale) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.dirty = true;
  }

  /** Computes the row positions and the total size after a change. */
  #compute() {
    if (!this.dirty) return;
    let y = this.padding;
    let width = 0;
    for (let i = 0; i < this.count; i++) {
      this.tops[i] = y;
      y += this.rowHeight(i) + (i < this.count - 1 ? this.gap : 0);
      width = Math.max(width, this.rowWidth(i));
    }
    this.tops[this.count] = y;
    this.height = y + this.padding;
    this.width = width + 2 * this.padding;
    this.dirty = false;
  }

  /**
   * Returns the width of a row (all sides and the gaps between them).
   * @param {number} index Row index.
   * @returns {number} Pixels.
   */
  rowWidth(index) {
    return this.columns * this.sizeOf(index).width * this.scale + (this.columns - 1) * this.columnGap;
  }

  /**
   * Returns the height of a row (with the space below it for captions).
   * @param {number} index Row index.
   * @returns {number} Pixels.
   */
  rowHeight(index) {
    return this.sizeOf(index).height * this.scale + this.extraHeight;
  }

  /**
   * Returns the top of a row.
   * @param {number} index Row index.
   * @returns {number} Pixels from the top of the scroll area.
   */
  top(index) {
    this.#compute();
    return this.tops[Math.min(Math.max(0, index), this.count)];
  }

  /**
   * Returns the size of the whole scroll area.
   * @returns {{width: number, height: number}} Pixels.
   */
  extent() {
    this.#compute();
    return { width: this.width, height: this.height };
  }

  /**
   * Finds the row at a position: the last row starting at or above it.
   * @param {number} y Pixels from the top of the scroll area.
   * @returns {number} Row index (0 when there are no rows).
   */
  indexAt(y) {
    this.#compute();
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /**
   * Finds the rows between two positions.
   * @param {number} top Upper position in pixels.
   * @param {number} bottom Lower position in pixels.
   * @returns {{first: number, last: number}} First and last row index.
   */
  range(top, bottom) {
    return { first: this.indexAt(top), last: this.indexAt(bottom) };
  }

  /**
   * Describes a position by its row, so it can be found again after sizes or the scale changed.
   * @param {number} y Pixels from the top of the scroll area.
   * @returns {{index: number, fraction: number}} Row and the share of the row (with the gap below
   *   it) above the position.
   */
  anchor(y) {
    const index = this.indexAt(y);
    return { index, fraction: (y - this.top(index)) / (this.rowHeight(index) + this.gap) };
  }

  /**
   * Returns the position an anchor points to now.
   * @param {{index: number, fraction: number}} anchor Anchor from `anchor()`.
   * @returns {number} Pixels from the top of the scroll area.
   */
  positionOf({ index, fraction }) {
    return this.top(index) + fraction * (this.rowHeight(index) + this.gap);
  }

  /**
   * Computes the zoom at which the estimated row fits the available space.
   * @param {'fitWidth'|'fitPage'} mode Fit the width, or the width and the height.
   * @param {number} width Available width in pixels.
   * @param {number} height Available height in pixels.
   * @param {number} baseScale CSS pixels per page unit at zoom 1.
   * @returns {number} Zoom factor.
   */
  fitZoom(mode, width, height, baseScale) {
    const { estimate } = this;
    const fitW = (width - (this.columns - 1) * this.columnGap) / (this.columns * estimate.width * baseScale);
    const fitH = (height - this.extraHeight) / (estimate.height * baseScale);
    return mode === 'fitWidth' ? fitW : Math.min(fitW, fitH);
  }
}
