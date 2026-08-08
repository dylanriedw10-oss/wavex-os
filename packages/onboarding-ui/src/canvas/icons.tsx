/** The canvas glyph vocabulary — a handful of hand-drawn strokes shared by
 *  the wheel, node views, trace, board, and desk. No icon dependency;
 *  every glyph is a 24-box stroke drawing, colored by its consumer. */

import type { ReactNode } from "react";

export const ICON_PATHS: Record<string, ReactNode> = {
  /* Added for onboarding (the standardization pass): selection, connection,
   * and identity — the three ideas its emoji were carrying. */
  check: <path d="M4.5 12.5l5 5 10-10" />,
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8Z" />
      <path d="M12 16.5V21" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.8-3.1 3-4.7 5.5-4.7s4.7 1.6 5.5 4.7" />
      <circle cx="16.5" cy="9.5" r="2.3" />
      <path d="M16.6 14.6c2.1.4 3.5 1.7 4 3.9" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l5.2-5.2 3.6 3 6.4-7" />
      <path d="M14.5 7.5h3.7v3.7" />
    </>
  ),
  box: (
    <>
      <path d="M12 3l7.5 4.2v9.6L12 21l-7.5-4.2V7.2z" />
      <path d="M4.8 7.4L12 11.5l7.2-4.1" />
      <path d="M12 11.5V21" />
    </>
  ),
  chat: (
    <>
      <path d="M4.5 5.5h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H10l-4.5 3.7V15.5h-1a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="0.5" />
    </>
  ),
  wave: <path d="M3 12h3.5l2.2-6 4.6 12 2.2-6H21" />,
  bars: (
    <>
      <path d="M5.5 19v-8" />
      <path d="M12 19V5.5" />
      <path d="M18.5 19v-5.5" />
    </>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="9" ry="4.3" transform="rotate(-18 12 12)" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.5c.9-3.4 3.4-5.2 6.5-5.2s5.6 1.8 6.5 5.2" />
    </>
  ),
  law: (
    <>
      <path d="M12 5c-1.8-1.3-4.2-1.6-7-1v14.5c2.8-.6 5.2-.3 7 1 1.8-1.3 4.2-1.6 7-1V4c-2.8-.6-5.2-.3-7 1z" />
      <path d="M12 5v14.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21c-4.5-4.6-6.5-7.6-6.5-10.5a6.5 6.5 0 0 1 13 0c0 2.9-2 5.9-6.5 10.5z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l8.5 4.7L12 12.9 3.5 8.2z" />
      <path d="M4 12.7l8 4.4 8-4.4" />
      <path d="M4 16.7l8 4.4 8-4.4" />
    </>
  ),
};

export function Ic({ name, size = 16, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      {ICON_PATHS[name] ?? ICON_PATHS.orbit}
    </svg>
  );
}
