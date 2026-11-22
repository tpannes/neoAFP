/**
 * Compressed versions of one 96 × 40 bilevel test bitmap, made with libtiff 4 (through Pillow)
 * from the bitmap defined below: CCITT Group 3 one-dimensional (MH), Group 3 two-dimensional (MR,
 * T4Options bit 0), Group 4 (MMR), TIFF LZW and PackBits (TIFF strip data, MSB first, one strip,
 * 1 bit = black). Used by the decoder tests (T050, T051).
 */
/** Width, height and bytes per row of the test bitmap. */
export const W = 96;
export const H = 40;
const ROW = 12;

/** The test bitmap: irregular runs, a filled block and full rows (1 = black). */
export const black = (x, y) => ((x * 7 + y * 13) % 17 < 6) || (x > 60 && y % 5 === 0) || (x >= 10 && x < 30 && y >= 12 && y < 20);

/** The bitmap as rows of bits, most significant bit first. */
export function expectedBits() {
  const out = new Uint8Array(ROW * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (black(x, y)) out[y * ROW + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

export const G3_1D = b64(
  'ABNU6HTodWh06HTodWh06HTodWh06HTocNMAEdDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnABtDp0OnQ6tDp' +
  '0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OACaodWh06HTodWh06HTodWh06HTodWh06HTodWh06HTodWh0OACap0OrQ6dDp0' +
  'OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQAI6HTodWh06HTodWh06HTodWh06HTodDhpgAjp0OnQ6tDp0OnQ6tDp0OnQ6tD' +
  'p0OnQ6tDp0OnQ6tDp0OnQ4ALodOh06HVodOh06HVodOh06HVodOh06HVodOh06HVodOh0OACaq0OnQ6dDq0OnQ6dDq0OnQ6d' +
  'Dq0OnQ6dDq0OnQ6dDq0OnQAI6HVodOh06HVodOh06HVodOh06HVodOh06HVodOh06HVodAAjp0OrQ6dDp0OrQ6dDp0OrQ6dD' +
  'p0OoDTABdDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OhwATVDp0OnDRaHTodOh1aHTodOh1aHTodOh1aHTodOg' +
  'AYQ6dDhsHVodOh06HVodOh06HVodOh06HVodOh0ACOrQ6HDY6HVodOh06HVodOh06HVodOh06HVodOAC6HVhsHQ6dDq0OnQ6' +
  'dDqw1AATVDp0OnDQOnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDqAATVOh06HDQ6HTodOh1aHTodOh1aHTodOh1aHTodOh0ACOh06' +
  'HQ4bLQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDpwAbQ6cNg6HVodOh06HVodOh06HVodOh06HVodOhwATVDq0OnQ6dDq0OnQ6dDq0' +
  'OnQ6dDq0OGoACap0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQAI6HTodWh06HTodWh06HTodWh06HTodWh06HT' +
  'odWh06HTodOACOnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDgAuh06HTodWh06HTodWh06HTodWh06HTodWh0' +
  '6HTodWh06HQ4AJqrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6cNMAEdDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OgAR0' +
  '6HVodOh06HVodOh06HVodOh06HVodOh06HVodOh06HVgAuh06HVodOh06HVodOh06HVodOh06HVodOh06HVodOh06HQ4AJqh' +
  '06HTodWh06HTodWh06HTodWh06HTodWh06HTodWh06HToAGEOnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ4aYAI6tDp0OnQ6tDp0OnQ' +
  '6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDpwAXQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDgAmqHTodWh06HTodWh06H' +
  'TodWh06HTodWh06HTodWh06HTodQACap0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6ABHQ6dDp0OrQ6dDp0Or' +
  'Q6dDp0OrQ6dDocNMAG0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ4AJqh1aHTodOh1aHTodOh1aHTodOh1aHTo' +
  'dOh1aHTodOh1aHQ4AJqnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tAAjodOh1aHTodOh1aHTodOh1aHTodOh1a' +
  'HTodOh1aHTodOh04');
export const G3_2D = b64(
  'ABmqdDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OGmACYWwtlDhCwthbKHCFhbC2UOELC2FsocqyhynKHKcocqyhynKHCgA7Q6dDp0O' +
  'rQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDgAiaoIIWFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOELC4AM1TodWh06' +
  'HTodWh06HTodWh06HTodWh06HTodWh06HTodWgATC2UOELC2FsocIWFsLZQ4QsLYWyhwoiIiIiIiMAGOnQ6dDq0OnQ6dDq0O' +
  'nQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDgAmFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOELC2FwAZqrQ6dDp0OrQ6dDp0OrQ' +
  '6dDp0OrQ6dDp0OrQ6dDp0OrQ6dAAmUOELC2FsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhYAMdOh1aHTodOh1aHTodOh1' +
  'aHTodOh1AaYAJhbKHCFhbC2UOELC2FsocIWFsLZQ5VlDlOUOU5Q5VlDlOUOU4IJQAZqh06HThotDp0OnQ6tDp0OnQ6tDp0On' +
  'Q6tDp0OnQAIWFsodhBCwthbKHCFhbC2UOELC2FsocIWFsLABjq0Ohw2Oh1aHTodOh1aHTodOh1aHTodOh1aHTgAmUOELQQWy' +
  'hwhYWwtlDhCxEREREREMAGaodOh04aB06HTodWh06HTodWh06HTodWh06HTodQAC2FsoewthbKHCFhbC2UOELC2FsocIWFsL' +
  'YSgAx0OnQ6HDZaHTodOh1aHTodOh1aHTodOh1aHTodOACFhbRHQQQsLYWyhwhYWwtlDhCwthbKHCFhbUAGaodWh06HTodWh0' +
  '6HTodWh06HTodWhw1AAWyhwhYWwtlDhCwthbKHCFhbC2UOELKHKcocpyhyrKHKcocpyhyrgAx0OnQ6tDp0OnQ6tDp0OnQ6tD' +
  'p0OnQ6tDp0OnQ6tDp0OnQ6cAFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOELC2FtQAbodOh06HVodOh06HVodOh06HVod' +
  'Oh06HVodOh06HVodOh0OACCCFhbC2UOELC2FsocIWFsLZQ4QsLYiIiIiIiwAY6HVodOh06HVodOh06HVodOh06HVodOh06HV' +
  'odOh06HVodAAtlDhCwthbKHCFhbC2UOELC2FsocIWFsLZQ4QsLYWyhwhYAN0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6tDp0OnQ6' +
  'tDp0OnQ6HABBBbC2UOELC2FsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthbgA4Q6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDhpgAgghYWw' +
  'tlDhCwthbKHCFhbC2UOELC2UOU5Q5VlDlOUOU5Q5VlDhQAbodWh06HTodWh06HTodWh06HTodWh06HTodWh06HTodWhwAQQW' +
  'yhwhYWwtlDhCwthbKHCFhbC2UOELC2FsocIWFsLZQ4QwAZqnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDq0OnQ6dDoAEw' +
  'thbKHCFhbC2UOELC2FsocIWFsLiIiIiIiIwAdodOh06HVodOh06HVodOh06HVodOh06HVodOh06HVodOhwARNUEELC2FsocI' +
  'WFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhcAGap0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQ6dDp0OrQAJhbKHCFhbC2UO' +
  'ELC2FsocIWFsLZQ4QsLYWyhwhYWwtlDhMA==');
export const G4 = b64(
  'Jqi6I6Lojo2iOi6I6Lojo2iOi6I6Lojo2iOi6I6LojhpsLYWyhwhYWwtlDhCwthbKHCFhbC2UOVZQ5TlDlOUOVZQ5TlDhRYW' +
  'wtlDhCwthbKHCFhbC2UOELC2FsocIWFsLZQ4QsLak1QQQsLYWyhwhYWwtlDhCwthbKHCFhbC2UOELC2FsocIWF9lDhCwthbK' +
  'HCFhbC2UOELC2FsocIWFsLZQ4QsLYWyhwhdhbKHCFhbC2UOELC2FsocIWFsLZQ4URERERERHsLZQ4QsLYWyhwhYWwtlDhCwt' +
  'hbKHKsocpyhynKHKsocpyhynVhbC2UOELC2FsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthcIIWFsLZQ4QsLYWyhwhYWwtlDhCwt' +
  'hbKHCFhbC2UOELC3ZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOELC2FsocIWF7KHCFhbC2UOELC2FsocIWFsLZQ4QxERERER' +
  'EbC2UOELC2FsocIWFsLZQ4QsLYWyhyrKHKcocpyhyrKHKcocpwQShBbC2IiIgxYWwtlDhCwthbKHCFhbC2UOELC2FuLC2UOw' +
  'ghYWwtlDhCwthbKHCFhbC2UOELC2FhBCwvZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbZQ4QtBBbKHCFhbC2UOELEREREREQwgtl' +
  'DlP2FsocIWFsLZQ5VlDlOUOU5Q5VlDlOUOU5Q4LsLZQ9hbC2UOELC2FsocIWFsLZQ4QsLYWwlYWwuxYWwtlDhCwthbKHCFhb' +
  'C2UOELC2FsWFtEdBBCwthbKHCFhbC2UOELC2FsocIWFtSaoIIWUOU5Q5TlDlWUOCC7KHCFhbC2UOELCiIiIiIiIvZQ4QsLYW' +
  'yhwhYWwtlDhCwthbKHCFlDlOUOU5Q5VlDlOUOU5Q5V2FsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOE9hbKHCFhb' +
  'C2UOELC2FsocIWFsLZQ4QsLYWyhwhYWwtqwthbKHCFhbC2UOELC2FsocIWFsLZQ4QsLYWyhwhYWwuEELC2FsocIWFsLZQ4Qs' +
  'LYWyhwhYWxERERERFsocIWFsLZQ4QsLYWyhwhYWwtlDhCyhynKHKcocqyhynKHKcocqwl2UOELC2FsocIWFsLZQ4QsLYWyhw' +
  'hYWwtlDhCwthbKHCFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOELC2FsEEoQWwtlDhCwthbKHCFhbC2UOELC2FsocIWFs' +
  'LZQ4QsLYW4sLYWyhwhYWwtlDhCwthbKHCFhbCiIiIiIiIwghYWwtlDhCwthbKHCFhbC2UOELC2UOU5Q5VlDlOUOU5Q5VlDhW' +
  'UOELC2FsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFqEFsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOEPYWyhwh' +
  'YWwtlDhCwthbKHCFhbC2UOELC2FsocIWFsLYSsLYWyhwhYWwtlDhCwthbKHCFhbC4iIiIiIiMWFsLZQ4QsLYWyhwhYWwtlDh' +
  'CwtlDlOUOVZQ5TlDlOUOVZQ5TqTVBBCwthbKHCFhbC2UOELC2FsocIWFsLZQ4QsLYWyhwhYX2UOELC2FsocIWFsLZQ4QsLYW' +
  'yhwhYWwtlDhCwthbKHCF2FsocIWFsLZQ4QsLYWyhwhYWwtlDhCwthbKHCFhbC2UOEwAQAQ==');
export const LZW = b64(
  'gCUUJKKClFBSS7/hT/KSUFJKCilBRSQopISUicVi8DgsHjkGhsPiIKh0QiUUi0ClEbJRXhb/gkgksjKUik8agRKnEfg8Ojsh' +
  'k0ZoMoI8vlM8oClH7/fk2jIpCi/f7+ncxIVSf0/mYoP7/fsmB8vpVeo8xFCUqT8mU2KVYmk4BVdfssn9ISgvl8zm9Hlc5rVm' +
  'oE0p19gdVKCnl9awaFoeGsuKJVrxtQvZChMLumSCk9xcWyt+g2gzkmwMSl0Lp+Zj2AvUkzsbwmsgIA==');
export const PACKBITS = b64(
  'B5ShSlClKFKX/f8LUpQpShSlClKFKUKUCwpShSlClKFKUKUoUguhSlClKFKUKUoUpQoLlClKFKUKUoUpQpShB1KFKUKUoUpX' +
  '/f8LSlClKFKUKUoUpQpSCylKFKUKUoUpQpShSguFKUKUoUpQpShSlCkLUKUoUpQpShSlClKFB0oUpQpShSlH/f8LKUKUoUpQ' +
  'pShSlClKC6U///wpShSlClKFKQsUv//+hSlClKFKUKULQr///lClKFKUKUoUByh///1KFKUP/f8LpT///SlClKFKUKUoC5S/' +
  '//ylKFKUKUoUpQtSv//+FKUKUoUpQpQLCn///UKUoUpQpShSB6FKUKUoUpQv/f8LlClKFKUKUoUpQpShC1KFKUKUoUpQpShS' +
  'lAtKUKUoUpQpShSlClILKUoUpQpShSlClKFKB4UpQpShSlCn/f8LUKUoUpQpShSlClKFC0oUpQpShSlClKFKUAspQpShSlCl' +
  'KFKUKUoLpShSlClKFKUKUoUpBxSlClKFKUKX/f8LQpShSlClKFKUKUoUCyhSlClKFKUKUoUpQgulClKFKUKUoUpQpSgLlKFK' +
  'UKUoUpQpShSlB1KUKUoUpQpX/f8LClKFKUKUoUpQpShSC6FKUKUoUpQpShSlCguUKUoUpQpShSlClKELUoUpQpShSlClKFKU');

/** YCbCr → RGB pairs computed by Pillow 11 (ITU-R BT.601 full range, as in JPEG/JFIF). */
export const YCBCR_REFERENCE = [[[128,128,128],[128,128,128]],[[76,85,255],[254,0,0]],[[150,44,21],[0,255,1]],[[29,255,107],[0,0,254]]];
