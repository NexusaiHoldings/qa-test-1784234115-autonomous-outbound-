/**
 * active-theme — the resolved ThemeContract this company wears.
 * Written by provisioning (_step_substrate_install): an approved mood
 * board's derived theme wins, else the CMO's authored ThemeContract
 * (company-theme-authoring-001 / visual phase 3b). Do NOT hand-edit.
 */
import type { ThemeContract } from "./contract";

export const activeTheme: ThemeContract = {
  "type": {
    "fontBody": "inter",
    "fontHeading": "inter"
  },
  "color": {
    "bg": "#ffffff",
    "text": "#101828",
    "accent": "#1d4ed8",
    "border": "#d8dee8",
    "danger": "#b42318",
    "success": "#157f4a",
    "surface": "#f5f7fa",
    "textMuted": "#4a5568",
    "accentText": "#ffffff",
    "surfaceAlt": "#e9edf3",
    "borderStrong": "#b6c0cf"
  },
  "shape": {
    "radius": 8
  }
};
