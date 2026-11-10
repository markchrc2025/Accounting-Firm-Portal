/** Matches an em dash or an en dash. Built from char codes so no source file contains one. */
export const DASHES = new RegExp(
  `[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`,
);
