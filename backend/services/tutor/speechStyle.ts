/** Make model text sound natural when spoken by TTS. */
import { sentences } from "../text/sentences";

export const MAX_WORDS = 25;
export const RISK_NOTE = "Remember, prices can fall as well as rise.";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];

export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("whole, non-negative numbers only");
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred` + (n % 100 ? ` ${numberToWords(n % 100)}` : "");
  for (const [size, name] of SCALES) {
    if (n >= size) {
      const rest = n % size;
      return `${numberToWords(Math.floor(n / size))} ${name}` + (rest ? ` ${numberToWords(rest)}` : "");
    }
  }
  return String(n);
}

/** "$560" -> "five hundred sixty dollars"; "$1,403.50" -> "... dollars and fifty cents". */
export function speakMoney(amount: string): string {
  const [whole, frac = ""] = amount.replace(/[$,]/g, "").split(".");
  const dollars = Number(whole);
  const cents = Math.round(Number(`0.${frac || "0"}`) * 100);
  const d = `${numberToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  return cents ? `${d} and ${numberToWords(cents)} ${cents === 1 ? "cent" : "cents"}` : d;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Replace color-only references with shape language. */
export function describeShapes(text: string): string {
  return text.replace(
    /\b(the\s+)?(green|red|blue|orange|yellow|amber|teal|coral|purple|white)\s+(line|lines|bar|bars|dot|dots|area)\b/gi,
    (_, the, _color, thing) => `${the ?? ""}${thing}`,
  );
}

export function speakNumbers(text: string): string {
  return text
    .replace(/(-)?\$(\d[\d,]*(?:\.\d{1,2})?)/g, (_, neg, amt) => `${neg ? "minus " : ""}${speakMoney(amt)}`)
    .replace(/(\b(?:about|around|roughly|nearly|almost|over|under)\s+)?(-?\d+(?:\.\d+)?)\s?%/gi, (_, hedge, n) => {
      const v = n.startsWith("-") ? `minus ${n.slice(1)}` : n;
      return `${hedge ?? "about "}${v} percent`;
    });
}

/** Split sentences over MAX_WORDS at the comma or conjunction nearest the middle. */
export function splitLong(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= MAX_WORDS) return [sentence];
  const mid = words.length / 2;
  let best = -1;
  words.forEach((w, i) => {
    if (i < 3 || i > words.length - 4) return;
    const breaks = /[,;:]$/.test(w) || /^(and|but|so|because|while|which)$/i.test(words[i + 1] ?? "");
    if (breaks && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  });
  if (best < 0) best = Math.floor(mid);
  const first = words.slice(0, best + 1).join(" ").replace(/[,;:]$/, "") + ".";
  let rest = words.slice(best + 1);
  if (/^(and|but|so)$/i.test(rest[0] ?? "")) rest = rest.slice(1);
  const second = rest.join(" ");
  return [...splitLong(first), ...splitLong(second.charAt(0).toUpperCase() + second.slice(1))];
}

export function mentionsReturn(text: string): boolean {
  return /%|percent/i.test(text) && /\b(up|down|return(s|ed)?|gain(s|ed)?|grew|rose|fell|dropped|lost|change[ds]?|worth)\b/i.test(text);
}

const HAS_RISK = /fall as well as rise|could lose|can lose|not a promise|not what will happen|no guarantee/i;

export function toSpeech(text: string): string {
  const clean = speakNumbers(describeShapes(stripMarkdown(text)));
  let out = sentences(clean).flatMap(splitLong).join(" ");
  if (mentionsReturn(text) && !HAS_RISK.test(out)) out = `${out} ${RISK_NOTE}`;
  return out;
}
