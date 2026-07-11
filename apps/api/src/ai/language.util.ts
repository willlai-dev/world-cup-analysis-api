/**
 * True when the output plausibly is 繁體中文 (or at least contains Chinese).
 * NVIDIA Nemotron occasionally answers zh-prompted tasks entirely in English;
 * an English analysis has ~0 CJK characters, while even a terse Chinese JSON
 * (e.g. a translated player name) has a few, so a small length-scaled
 * threshold separates the two without false-failing short valid outputs.
 */
export function looksChinese(content: string): boolean {
  const cjk = content.match(/[㐀-䶿一-鿿]/g)?.length ?? 0;
  const threshold = Math.min(20, Math.max(1, Math.ceil(content.length * 0.02)));
  return cjk >= threshold;
}
