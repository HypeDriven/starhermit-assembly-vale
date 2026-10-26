// The look: the browser build's css/style.css, rewritten class-based in
// tools/ui-style.css and converted once with `starhermit css` into
// assets/ui-style.json, registered at start with the theme the runtime's
// widgets fall back to.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export const COLORS = {
  bg: "#101a14", panel: "#1b2a21", panel2: "#24382b", ink: "#eef6ee", dim: "#b7c9ba",
  accent: "#ffd166", accentInk: "#20180a", line: "#3c5a45", good: "#7fd48f", bad: "#ff9b8a",
};

/** Registers the styles once. */
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 24,
    text: COLORS.ink, muted: COLORS.dim, panel: COLORS.panel, control: COLORS.panel2,
    hovered: "#2f4838", pressed: "#2f4838", field: COLORS.panel2, accent: COLORS.accent,
    focus: COLORS.accent, outline: COLORS.line,
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles(css.styles);
}
