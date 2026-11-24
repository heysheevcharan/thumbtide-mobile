import QRCode from "qrcode";

export interface QROptions {
  /** Pixel size of the square (default 256). */
  size?: number;
  dark?: string;
  light?: string;
  margin?: number;
}

/** Draw a QR code into a canvas. */
export async function renderQR(canvas: HTMLCanvasElement, text: string, o: QROptions = {}): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: o.size ?? 256,
    margin: o.margin ?? 1,
    errorCorrectionLevel: "M",
    color: { dark: o.dark ?? "#000000", light: o.light ?? "#ffffff" },
  });
}

/** QR code as an SVG string (crisp at any TV resolution). */
export function qrSvg(text: string, o: QROptions = {}): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: o.margin ?? 1,
    errorCorrectionLevel: "M",
    color: { dark: o.dark ?? "#000000", light: o.light ?? "#ffffff" },
  });
}
