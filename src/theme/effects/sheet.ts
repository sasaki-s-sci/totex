import { useInsertionEffect } from "react";

/**
 * One `<style>` in the head for as long as `css` is a string; `null` takes it out again, so
 * switching an effect off leaves nothing behind. Appended last so equal-strength rules win.
 */
export function useStyleSheet(name: string, css: string | null): void {
  useInsertionEffect(() => {
    if (css === null) return;
    const sheet = document.createElement("style");
    sheet.dataset.effects = name;
    sheet.textContent = css;
    document.head.append(sheet);
    return () => sheet.remove();
  }, [name, css]);
}
