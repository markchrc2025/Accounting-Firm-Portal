// The internal BIR Forms engine (ported from the Sentire generator).
// 2551Q (Phase 1-2) + 2550Q (Phase 4) compute + eBIRForms XML. More forms land
// in later phases.

export * from "./types";
export { num, roundPeso } from "./format";
export { parsePeriod, buildPeriod, isQuarterlyForm, QUARTERLY_FORMS } from "./period";
export { compute2551Q, type Comp2551Q, type Comp2551QRow } from "./compute2551Q";
export { build2551Q, fileName2551Q } from "./build2551Q";
export { compute2550Q, type Comp2550Q } from "./compute2550Q";
export { build2550Q, fileName2550Q } from "./build2550Q";
export { compute1701Q, type Comp1701Q, type Side1701Q } from "./compute1701Q";
export { build1701Q, fileName1701Q } from "./build1701Q";
export { graduatedTax } from "./taxTables";
