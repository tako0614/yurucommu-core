// Bun migration shim: @std/fmt/colors -> minimal ANSI implementation.
// Honors NO_COLOR / TERM=dumb like @std/fmt/colors. Wired via tsconfig "paths".
import process from "node:process";
const noColor = typeof process !== "undefined" &&
  (process.env.NO_COLOR != null || process.env.TERM === "dumb");
let enabled = !noColor;

export function setColorEnabled(value: boolean): void {
  enabled = value;
}
export function getColorEnabled(): boolean {
  return enabled;
}

function code(open: number, close: number) {
  return (
    str: string,
  ): string => (enabled ? `\x1b[${open}m${str}\x1b[${close}m` : str);
}

export const reset = code(0, 0);
export const bold = code(1, 22);
export const dim = code(2, 22);
export const italic = code(3, 23);
export const underline = code(4, 24);
export const inverse = code(7, 27);
export const hidden = code(8, 28);
export const strikethrough = code(9, 29);
export const black = code(30, 39);
export const red = code(31, 39);
export const green = code(32, 39);
export const yellow = code(33, 39);
export const blue = code(34, 39);
export const magenta = code(35, 39);
export const cyan = code(36, 39);
export const white = code(37, 39);
export const gray = code(90, 39);
export const brightBlack = code(90, 39);
export const brightRed = code(91, 39);
export const brightGreen = code(92, 39);
export const brightYellow = code(93, 39);
export const brightBlue = code(94, 39);
export const brightMagenta = code(95, 39);
export const brightCyan = code(96, 39);
export const brightWhite = code(97, 39);
export const bgBlack = code(40, 49);
export const bgRed = code(41, 49);
export const bgGreen = code(42, 49);
export const bgYellow = code(43, 49);
export const bgBlue = code(44, 49);
export const bgMagenta = code(45, 49);
export const bgCyan = code(46, 49);
export const bgWhite = code(47, 49);

export function stripAnsiCode(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
export const stripColor = stripAnsiCode;
