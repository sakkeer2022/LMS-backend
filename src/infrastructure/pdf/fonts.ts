import fs from 'node:fs/promises';
import path from 'node:path';

export type Script = 'latin' | 'devanagari' | 'arabic';

const FILES: Record<Script, string> = {
  latin: 'NotoSans-Regular.ttf',
  devanagari: 'NotoSansDevanagari-Regular.ttf',
  arabic: 'NotoSansArabic-Regular.ttf',
};

// Fonts are read from the project's assets folder (the service runs from the project root)
const FONT_DIR = path.resolve(process.cwd(), 'assets/fonts');
const cache = new Map<Script, Promise<Buffer>>();

export function loadFont(script: Script): Promise<Buffer> {
  let font = cache.get(script);
  if (!font) {
    font = fs.readFile(path.join(FONT_DIR, FILES[script]));
    cache.set(script, font);
  }
  return font;
}

const DEVANAGARI = /\p{Script=Devanagari}/u;
const ARABIC = /\p{Script=Arabic}/u;

/** The script of one character; everything else (Latin, digits, punctuation, spaces) uses the Latin font. */
export function scriptOf(char: string): Script {
  if (DEVANAGARI.test(char)) return 'devanagari';
  if (ARABIC.test(char)) return 'arabic';
  return 'latin';
}

/** Splits text into consecutive runs of one script; a space or punctuation joins the run before it. */
export function splitRuns(text: string): { script: Script; text: string }[] {
  const runs: { script: Script; text: string }[] = [];
  for (const char of text) {
    const neutral = /[\s\p{P}\p{N}]/u.test(char);
    const script = neutral && runs.length > 0 ? runs[runs.length - 1]!.script : scriptOf(char);
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += char;
    else runs.push({ script, text: char });
  }
  return runs;
}
