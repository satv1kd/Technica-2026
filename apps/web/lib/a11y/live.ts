/** Announce text to screen readers through the polite live region. */
export function announce(text: string): void {
  if (typeof document === "undefined") return;
  const region = document.getElementById("sonar-live");
  if (!region) return;
  // Clear first so repeating the same sentence is announced again.
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = text;
  }, 30);
}
