// @portal/bir-pdf — print a filed return onto the BIR's own blank form.
//
//   const rows = parseEbirExport(exportFileText);          // [key, value][] in file order
//   const pdf = await renderReturn("2551Q", "2018-01", rows); // Uint8Array
//
// Deterministic: the field maps in maps/ hold resolved box geometry, read from
// the template's own vector boxes by tools/geometry.py. See README.md.
export { parseEbirExport, ENCODED_KEYS } from "./parse";
export { renderReturn, renderProof, loadMap, type RenderOptions } from "./render";
export { layoutReturn, layoutGhost, type Metrics } from "./layout";
export { validateMap } from "./validate";
export * from "./types";
