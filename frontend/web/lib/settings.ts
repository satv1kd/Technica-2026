import type { Speed } from "./voice/tts";

export type TextSize = "standard" | "large" | "xl";

export interface Settings {
  speed: Speed;
  chartSounds: boolean;
  textSize: TextSize;
}

export const DEFAULT_SETTINGS: Settings = { speed: "normal", chartSounds: false, textSize: "standard" };
export const TEXT_SCALE: Record<TextSize, number> = { standard: 1, large: 1.5, xl: 2 };
const KEY = "sonar-settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings last for this visit only.
  }
}

export function flag(name: string): boolean {
  try {
    return localStorage.getItem(`sonar-${name}`) === "1";
  } catch {
    return false;
  }
}

export function setFlag(name: string) {
  try {
    localStorage.setItem(`sonar-${name}`, "1");
  } catch {}
}

const SPEEDS: Speed[] = ["slow", "normal", "fast"];
const SIZES: TextSize[] = ["standard", "large", "xl"];
export const nextSpeed = (s: Speed) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length];
export const nextSize = (s: TextSize) => SIZES[(SIZES.indexOf(s) + 1) % SIZES.length];
export const sizeName = (s: TextSize) => (s === "xl" ? "extra large" : s);

export type SettingKey = "speed" | "chartSounds" | "textSize";

/** Change one setting and say what changed ("Speaking speed is now fast"). */
export function toggleSetting(s: Settings, key: SettingKey): { settings: Settings; say: string } {
  switch (key) {
    case "speed": {
      const speed = nextSpeed(s.speed);
      return { settings: { ...s, speed }, say: `Speaking speed is now ${speed}.` };
    }
    case "chartSounds": {
      const chartSounds = !s.chartSounds;
      return { settings: { ...s, chartSounds }, say: `Chart sounds are now ${chartSounds ? "on" : "off"}.` };
    }
    case "textSize": {
      const textSize = nextSize(s.textSize);
      return { settings: { ...s, textSize }, say: `Text size is now ${sizeName(textSize)}.` };
    }
  }
}

export function applyTextSize(size: TextSize) {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--text-scale", String(TEXT_SCALE[size]));
  }
}
