/**
 * Plain text of a page for the text export (FR-099): the text runs of a page render model put
 * into lines. Runs whose baselines lie within a small distance form one line; lines go top to
 * bottom, runs within a line left to right. Runs that touch are joined directly, runs with a gap
 * get one space between them. Rotated text is placed by its starting point like other text.
 */

/** Baselines closer than this (page units, 1/1440 inch, about 0.7 mm) share a line. */
const SAME_LINE = 40;

/**
 * Estimates the width of a run (page units): its last glyph position plus one average glyph.
 * @param {{dx?: number[], font?: {size?: number}}} run Glyph run.
 * @returns {number} Width.
 */
function runWidth(run) {
  const dx = run.dx ?? [];
  const n = dx.length;
  if (n < 2) return n ? glyphWidth(run) : 0;
  return dx[n - 1] + dx[n - 1] / (n - 1);
}

/**
 * Average glyph advance of a run, or a guess from the font size.
 * @param {{dx?: number[], font?: {size?: number}}} run Glyph run.
 * @returns {number} Width (page units).
 */
function glyphWidth(run) {
  const dx = run.dx ?? [];
  if (dx.length > 1 && dx[dx.length - 1] > 0) return dx[dx.length - 1] / (dx.length - 1);
  return (run.font?.size ?? 200) * 0.5;
}

/**
 * Puts the text of a page into lines.
 * @param {{items: object[]}} model Page render model.
 * @returns {string[]} Lines in reading order (no trailing blanks).
 */
export function pageTextLines(model) {
  const runs = model.items.filter((i) => i.type === 'glyphRun' && i.text)
    .map((r) => ({ x: r.x, y: r.y, text: r.text, width: runWidth(r), glyph: glyphWidth(r) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const run of runs) {
    const line = lines[lines.length - 1];
    if (line && run.y - line.y <= SAME_LINE) line.runs.push(run);
    else lines.push({ y: run.y, runs: [run] });
  }
  return lines.map(({ runs: parts }) => {
    parts.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const p of parts) {
      if (text && p.x - end > p.glyph * 0.3) text += ' ';
      text += p.text;
      end = Math.max(end, p.x + p.width);
    }
    return text.trimEnd();
  });
}
