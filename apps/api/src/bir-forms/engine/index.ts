// The internal BIR Forms engine (ported from the Sentire generator).
// Phase 1: 2551Q compute + eBIRForms XML. More forms land in later phases.

export * from "./types";
export { num, roundPeso } from "./format";
export { parsePeriod, buildPeriod, isQuarterlyForm, QUARTERLY_FORMS } from "./period";
export { compute2551Q, type Comp2551Q, type Comp2551QRow } from "./compute2551Q";
export { build2551Q, fileName2551Q } from "./build2551Q";
