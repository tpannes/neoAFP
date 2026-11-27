/**
 * Color picker, shared by the page view and the Resource-Explorer preview. The view tells it
 * where the pointer is; it asks the view what lies there (`locate`), has the element outlined
 * (`outline`) and shows a tooltip beside the pointer:
 * - the color as given in the file (color space and values, e.g. "CMYK 100 20 0 0 %"; "default
 *   color" when none is given) and on screen, which is only an approximation (no color
 *   management); an RGB color drawn as given shows once, as values and as hex;
 * - the element and where it comes from; with several elements on top of each other, which one of
 *   how many (Tab, Shift+Tab or Alt+click steps through them);
 * - "Click to copy": RGB as hex, other color spaces as given in the file.
 * Images neoAFP decodes itself (IOCA, IM) give their pixel from the worker: exact, with the value
 * in the image's color space. Paper is white (not read from the canvas, which browsers with
 * fingerprinting protection change slightly).
 *
 * Keys (key()): arrows move the point by one screen pixel (Shift: ten), Tab/Shift+Tab step through
 * stacked elements, Enter copies. Touch: a tap shows the color, a second tap on the same element
 * copies it.
 */

import { t } from '../i18n/i18n.js';

/** Characters of a text element shown in the tooltip. */
const TIP_TEXT = 40;
/** Color of the paper. */
const PAPER = '#ffffff';
/** Screen pixels within which a second tap counts as a tap on the same spot. */
const TAP_SLACK = 24;

/**
 * Names a drawn element.
 * @param {object} item Render item.
 * @returns {string} Description, e.g. 'Text: "Dear Sir"'.
 */
export function describeItem(item) {
  if (item.type === 'glyphRun') {
    const text = (item.text ?? (item.chars ?? []).join('')).trim();
    return t('inspect.kind.text', { text: text.length > TIP_TEXT ? `${text.slice(0, TIP_TEXT)}…` : text });
  }
  if (item.type === 'placeholder') return t('inspect.kind.placeholder', { name: item.resourceName ?? '' });
  return t(`inspect.kind.${['image', 'pdf', 'rule', 'path'].includes(item.type) ? item.type : 'other'}`);
}

/**
 * Says where an element comes from when it is not drawn by the page itself.
 * @param {object} item Render item.
 * @returns {string|null} E.g. "From overlay O1FORM", or null for the page's own elements.
 */
export function sourceOf(item) {
  if (item.mediumOverlay) return t('inspect.fromMedium', { name: item.mediumOverlay });
  const named = item.via?.findLast((v) => v.name);
  return named ? t(named.type === 'overlay' ? 'inspect.fromOverlay' : 'inspect.fromSegment', { name: named.name }) : null;
}

/**
 * The color an item is drawn in, as the renderer has it ("#rrggbb"), or null (images, gradients).
 * @param {object} item Render item.
 * @returns {string|null} Color.
 */
function drawnColor(item) {
  if (item.type === 'image' || item.type === 'pdf' || item.type === 'placeholder') return null;
  const color = item.color ?? item.fill ?? item.stroke;
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

/**
 * Color of the set pels of a bilevel image (black unless the file gives one).
 * @param {object} item Image item.
 * @returns {string} "#rrggbb".
 */
function inkColor(item) {
  const c = item.color ?? item.inline?.color;
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#000000';
}

/**
 * The colors of a pick: as given in the file, and on screen.
 * - Images neoAFP decodes itself: the pixel from the worker (`d.image`): a color pel with its
 *   value in the image's color space and its RGB; a set bilevel pel in the image color; an unset
 *   or masked pel shows the paper.
 * - Other elements: the item's color specification, and its own color on screen where it has one
 *   (edges of text and lines blend with the paper, so the pixel there is no color of the file),
 *   else the canvas pixel (images the browser decodes, gradients).
 * - Paper: white.
 * @param {{item: object|null, pixel: string|null, image?: object}} d Pick.
 * @returns {{spec: {space: string, value: string}|null, screen: string|null}} Colors.
 */
function colorOf(d) {
  if (!d.item) return { spec: null, screen: PAPER };
  const px = d.image;
  if (px?.rgb) return { spec: px.spec ?? null, screen: px.rgb };
  if (px && 'ink' in px) return px.ink ? { spec: d.item.colorSpec ?? null, screen: inkColor(d.item) } : { spec: null, screen: PAPER };
  return { spec: d.item.colorSpec ?? null, screen: drawnColor(d.item) ?? d.pixel };
}

/**
 * Writes RGB values given as text as a hex color.
 * @param {string} value E.g. "16 185 129".
 * @returns {string|null} E.g. "#10b981", or null when the text holds no three values 0–255.
 */
function rgbHex(value) {
  const parts = value.split(' ').map(Number);
  if (parts.length !== 3 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The text a click copies: RGB always as hex (the color in the file, or as drawn for 16-bit
 * values), other color spaces as given in the file, without a color in the file as drawn.
 * @param {{item: object|null, pixel: string|null}} d Pick.
 * @returns {string|null} E.g. "#005ab4" or "CMYK 100 20 0 0 %".
 */
function copyValue(d) {
  const { spec, screen } = colorOf(d);
  if (spec?.space === 'RGB') return rgbHex(spec.value) ?? screen;
  return spec ? `${spec.space} ${spec.value}` : screen;
}

/**
 * Where on an image a pick lies, for asking the worker for the pixel: the point turned back into
 * the image's own orientation, as fractions of its width and height.
 * @param {{item: object|null, x?: number, y?: number}} d Pick.
 * @returns {{fx: number, fy: number}|null} Position, or null when not over an image with a reference.
 */
function imageSpot(d) {
  const item = d?.item;
  if (item?.type !== 'image' || !item.imageRef || !item.rect?.width || !item.rect?.height || d.x === undefined) return null;
  const a = (-(item.rotation ?? 0) * Math.PI) / 180;
  const dx = d.x - item.rect.x;
  const dy = d.y - item.rect.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const fx = lx / item.rect.width;
  const fy = ly / item.rect.height;
  return fx >= 0 && fy >= 0 && fx < 1 && fy < 1 ? { fx, fy } : null;
}

/**
 * Reads the color of one canvas pixel (transparent pixels show the white paper).
 * @param {HTMLCanvasElement|null} canvas Canvas.
 * @param {number} cx Column.
 * @param {number} cy Row.
 * @returns {string|null} "#rrggbb", or null when it cannot be read.
 */
function canvasPixel(canvas, cx, cy) {
  if (!canvas?.width || cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) return null;
  try {
    const [r, g, b, a] = canvas.getContext('2d').getImageData(cx, cy, 1, 1).data;
    const over = (v) => Math.round((v * a) / 255 + 255 * (1 - a / 255));
    return `#${[r, g, b].map((v) => over(v).toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return null;
  }
}

/**
 * A tooltip line of text.
 * @param {string} className Class names.
 * @param {string} text Text.
 * @returns {HTMLElement} Line.
 */
function textLine(className, text) {
  return Object.assign(document.createElement('div'), { className, textContent: text });
}

/**
 * A tooltip line with a color swatch before the text.
 * @param {string} className Class names.
 * @param {string} text Text.
 * @param {string|null} color Swatch color, or null for none.
 * @returns {HTMLElement} Line.
 */
function swatchLine(className, text, color) {
  const line = textLine(`${className} pick-line`, '');
  if (color) {
    const swatch = document.createElement('span');
    swatch.className = 'pick-swatch';
    swatch.style.background = color;
    line.append(swatch);
  }
  line.append(text);
  return line;
}

/**
 * @typedef {object} PickSpot What lies at a point (from the view's `locate`).
 * @property {object} model Render model.
 * @property {number} x Point x in page units of the model.
 * @property {number} y Point y in page units.
 * @property {object[]} items Items at the point, the likeliest first.
 * @property {HTMLCanvasElement|null} canvas Canvas the model is drawn on.
 * @property {number} cx Canvas pixel column of the point.
 * @property {number} cy Canvas pixel row of the point.
 */

export class ColorPicker {
  /**
   * @param {object} options Options.
   * @param {import('../worker-client.js').WorkerClient} options.client Worker client.
   * @param {HTMLElement} options.tip Tooltip element (fixed position, class inspect-tip).
   * @param {(clientX: number, clientY: number) => PickSpot|null} options.locate What lies at a
   *   window point, or null beside the drawing.
   * @param {(spot: PickSpot|null, item: object|null) => void} options.outline Outlines the
   *   current element (null, null: none).
   * @param {(text: string) => void} [options.status] Shows a message (copying failed).
   */
  constructor({ client, tip, locate, outline, status }) {
    Object.assign(this, { client, tip, locate, outline, status });
    this.at = null;
    this.spot = null;
    this.layer = 0;
    this.busy = false;
    this.exact = null;
  }

  /**
   * The pointer moved (or a key moved the point).
   * @param {number} clientX Window x.
   * @param {number} clientY Window y.
   * @param {string} [pointerType] 'mouse', 'pen' or 'touch'.
   * @returns {void}
   */
  move(clientX, clientY, pointerType = 'mouse') {
    const spot = this.locate(clientX, clientY);
    this.at = { clientX, clientY, pointerType };
    if (!spot) {
      this.leave();
      return;
    }
    // A new stack of elements starts with the likeliest one; the same stack keeps the one chosen.
    const key = spot.items.map((i) => spot.model.items.indexOf(i)).join(',');
    if (key !== this.stackKey || spot.model !== this.spot?.model) this.layer = 0;
    this.stackKey = key;
    this.spot = spot;
    this.#show();
  }

  /**
   * A click (or tap): copies the color; Alt+click steps to the next element; on touch the first tap
   * on a spot only shows the color.
   * @param {number} clientX Window x.
   * @param {number} clientY Window y.
   * @param {{pointerType?: string, altKey?: boolean}} [options] Pointer type and Alt key.
   * @returns {Promise<void>} Resolves when copied.
   */
  async click(clientX, clientY, { pointerType = 'mouse', altKey = false } = {}) {
    if (pointerType === 'touch') {
      const last = this.at;
      const same = last?.pointerType === 'touch' && Math.hypot(last.clientX - clientX, last.clientY - clientY) <= TAP_SLACK && this.tapped;
      if (!same) {
        this.tapped = true;
        this.move(clientX, clientY, 'touch');
        return;
      }
    } else {
      this.move(clientX, clientY, pointerType);
    }
    if (altKey) {
      this.cycle(1);
      return;
    }
    await this.copy();
  }

  /**
   * Handles a key while picking.
   * @param {KeyboardEvent} e Key event.
   * @returns {boolean} True when the key was used.
   */
  key(e) {
    if (!this.at) return false;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      const [dx, dy] = moves[e.key];
      this.move(this.at.clientX + dx, this.at.clientY + dy, this.at.pointerType === 'touch' ? 'touch' : 'key');
      return true;
    }
    if (e.key === 'Tab' && this.spot) {
      this.cycle(e.shiftKey ? -1 : 1);
      return true;
    }
    if (e.key === 'Enter' && this.spot) {
      this.copy();
      return true;
    }
    return false;
  }

  /**
   * Steps to the next (or previous) element at the point.
   * @param {number} direction 1 or −1.
   * @returns {void}
   */
  cycle(direction) {
    const n = this.spot?.items.length ?? 0;
    if (n < 2) return;
    this.layer = (this.layer + direction + n) % n;
    this.#show();
  }

  /**
   * Copies the current color and confirms it in the tooltip.
   * @returns {Promise<void>} Resolves when copied.
   */
  async copy() {
    if (!this.spot) return;
    const d = await this.#withImagePixel(this.#pick());
    const value = copyValue(d);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.#render(d, value);
    } catch {
      this.status?.(t('hex.copyFailed'));
    }
  }

  /** The pointer left the drawing: tooltip and outline go. */
  leave() {
    this.spot = null;
    this.tapped = false;
    this.tip.hidden = true;
    this.outline(null, null);
  }

  /** The picker was switched off: forgets everything and frees the image kept in the worker. */
  stop() {
    this.leave();
    this.at = null;
    this.exact = null;
    this.client?.call('releasePickedImage').catch(() => {});
  }

  /**
   * The current pick: element, point and canvas pixel.
   * @returns {{item: object|null, x: number, y: number, pixel: string|null, layer: number, count: number}} Pick.
   */
  #pick() {
    const { spot } = this;
    const item = spot.items[this.layer] ?? null;
    // The canvas pixel is only needed where the element has no color of its own.
    const pixel = item && !drawnColor(item) ? canvasPixel(spot.canvas, spot.cx, spot.cy) : null;
    return { item, x: spot.x, y: spot.y, pixel, layer: this.layer, count: spot.items.length };
  }

  /**
   * Outlines the current element and shows its color; over images neoAFP decodes itself the
   * worker's exact pixel follows (one request at a time; moves meanwhile keep only the latest).
   * @returns {void}
   */
  #show() {
    const d = this.#pick();
    this.outline(this.spot, d.item);
    this.last = d;
    const spot = imageSpot(d);
    // Over an image whose pixels came from the worker before, wait for its answer (no flicker
    // between the canvas pixel and the exact one).
    if (!spot || this.exact !== d.item.imageRef) this.#render(d);
    if (!spot || this.busy) return;
    this.busy = true;
    const ask = async () => {
      const asked = this.last;
      const answered = await this.#withImagePixel(asked);
      this.exact = answered.image ? asked.item.imageRef : null;
      if (this.last === asked) {
        if (this.spot) this.#render(answered);
        this.busy = false;
      } else if (imageSpot(this.last)) {
        await ask();
      } else {
        this.busy = false;
      }
    };
    ask().catch(() => { this.busy = false; });
  }

  /**
   * Adds the image pixel from the worker to a pick over an image (`image`: see getImagePixel;
   * missing for other elements and images the browser decodes).
   * @param {object} d Pick.
   * @returns {Promise<object>} The pick, with `image` when there is one.
   */
  async #withImagePixel(d) {
    const spot = imageSpot(d);
    if (!spot) return d;
    try {
      const image = await this.client.request({ method: 'getImagePixel', args: [d.item.imageRef, spot.fx, spot.fy], priority: 'high' });
      return image ? { ...d, image } : d;
    } catch {
      return d;
    }
  }

  /**
   * Fills the tooltip and places it beside the pointer.
   * @param {object} d Pick.
   * @param {string|null} [copied] Text just copied.
   * @returns {void}
   */
  #render(d, copied = null) {
    const { spec, screen } = colorOf(d);
    const lines = [];
    // An RGB color drawn as given needs no "in the file" and "on screen": one line, both notations.
    const same = spec?.space === 'RGB' && screen !== null && rgbHex(spec.value) === screen.toLowerCase();
    if (same) lines.push(swatchLine('inspect-kind', `RGB ${spec.value} · ${screen}`, screen));
    else if (spec) lines.push(swatchLine('inspect-kind', t('pick.specified', { color: `${spec.space} ${spec.value}` }), screen));
    else if (d.item && (d.image ? d.image.ink : drawnColor(d.item))) lines.push(swatchLine('inspect-kind', t('pick.default'), screen));
    if (d.item) {
      lines.push(textLine('inspect-hint', describeItem(d.item)));
      const from = sourceOf(d.item);
      if (from) lines.push(textLine('inspect-hint', from));
    } else {
      lines.push(textLine('inspect-kind', t('pick.paper')));
    }
    // Paper (no element, or where an image leaves it) is white as such: no "on screen".
    const paper = !d.item || d.image?.ink === false;
    if (screen && !same) lines.push(swatchLine('inspect-pos', paper ? screen : t('pick.screen', { color: screen }), screen));
    // Images read from the canvas: whether the screen color is the value in the file or converted.
    if (d.item?.type === 'image' && !d.image && d.item.pixelSpace !== 'bilevel') lines.push(textLine('inspect-hint', t(`pick.image.${d.item.pixelSpace ?? 'unknown'}`)));
    else if (d.item?.type === 'pdf') lines.push(textLine('inspect-hint', t('pick.image.unknown')));
    // On touch there is no Tab or Alt+click: only which element of how many.
    const touch = this.at?.pointerType === 'touch';
    if (d.count > 1) lines.push(textLine('inspect-hint', t(touch ? 'pick.layerTouch' : 'pick.layer', { n: d.layer + 1, count: d.count })));
    if (copyValue(d)) lines.push(textLine('inspect-hint', t(touch ? 'pick.tapHint' : 'pick.hint')));
    if (copied) lines.push(textLine('inspect-kind pick-copied', t('pick.copied', { value: copied })));
    this.tip.replaceChildren(...lines);
    this.tip.hidden = false;
    this.#place();
  }

  /** Places the tooltip beside the pointer (above the finger on touch), inside the window. */
  #place() {
    const { clientX, clientY, pointerType } = this.at;
    const { innerWidth, innerHeight } = window;
    const box = this.tip.getBoundingClientRect();
    const left = clientX + 16 + box.width > innerWidth ? clientX - 16 - box.width : clientX + 16;
    const below = pointerType !== 'touch' && clientY + 16 + box.height <= innerHeight;
    const top = below ? clientY + 16 : clientY - 40 - box.height;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, top)}px`;
  }
}
