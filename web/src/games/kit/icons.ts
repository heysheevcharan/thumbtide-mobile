import type { ControlIcon } from "../types.ts";

/** Small inline icons for controls (currentColor). */
export const CONTROL_ICONS: Record<ControlIcon, string> = {
  splat: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3c1.2 2.4 1 4 2.6 4.3 1.6.3 3.1-1.6 4.4-.6 1.3 1-.9 3 .2 4.3s3.6.6 3.6 2.1-2.7 1.2-3.2 2.7.9 3.3-.4 4.2-2.6-1.3-4.1-.8-1.4 3-3.1 3-1.6-2.6-3.1-3.1-3.2 1.6-4.3.6.8-3.1.1-4.4S.2 15 .3 13.5s2.9-1.2 3.2-2.7S2.4 7.6 3.7 6.9s2.8 1.3 4.3.8S10.6 3 12 3z"/></svg>`,
  dash: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 4l8 8-8 8v-5H3V9h10z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 5h5M1 19h6"/></svg>`,
  pulse: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5" fill="currentColor"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/></svg>`,
  jump: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3l7 8h-4v9H9v-9H5z"/></svg>`,
  action: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M12 5C6.5 5 2.7 8.6 1 12c1.7 3.4 5.5 7 11 7s9.3-3.6 11-7c-1.7-3.4-5.5-7-11-7zm0 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zm0 2.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z"/></svg>`,
  special: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/></svg>`,
};

export const STICK_ICON = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`;
