import qrcode from "qrcode-generator";
import { createMemo, type JSX } from "solid-js";

/**
 * Render a QR code as an inline SVG, framework-natively in Solid.
 *
 * Replaces the previous `qrcode.react` <QRCodeSVG>, which is a REACT component
 * (its only peer dependency is react) that was being force-cast into a Solid
 * element — calling it during render threw and the error boundary blanked the
 * whole app whenever the QR sheet was opened. `qrcode-generator` is a pure-JS
 * encoder with no framework dependency; we read its module matrix and emit one
 * `<path>` of unit squares for the dark modules.
 */
export function QrSvg(props: {
  value: string;
  size: number;
  class?: string;
}): JSX.Element {
  const model = createMemo(() => {
    // typeNumber 0 = auto-size to fit the data; "M" = ~15% error correction.
    const qr = qrcode(0, "M");
    qr.addData(props.value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { count, d };
  });

  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${model().count} ${model().count}`}
      shape-rendering="crispEdges"
      role="img"
      class={props.class}
    >
      <path d={model().d} fill="#000000" />
    </svg>
  );
}
