// Odd Word Out's fonts, bundled (the TV may have no internet): Lilita One for the big words, Inter (variable) for
// everything people read. Latin subsets, loaded from TS as inkling/font.ts explains.
import displayUrl from "./fonts/LilitaOne-latin.woff2?url";
import interUrl from "./fonts/Inter-latin.woff2?url";

let started: Promise<unknown> | null = null;

export function loadFonts(): Promise<unknown> {
  if (started) return started;
  if (typeof FontFace === "undefined") return Promise.resolve();
  const faces: Array<[string, string, string]> = [
    ["Odd Display", displayUrl, "400"],
    ["Odd Sans", interUrl, "100 900"],
  ];
  started = Promise.all(
    faces.map(([family, url, weight]) => {
      try {
        const face = new FontFace(family, `url(${url}) format("woff2")`, { display: "block", weight });
        document.fonts.add(face);
        return face.load().catch(() => undefined);
      } catch {
        return undefined;
      }
    }),
  );
  return started;
}
