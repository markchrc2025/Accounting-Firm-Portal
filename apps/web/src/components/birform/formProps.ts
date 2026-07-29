// formProps.ts — shared prop contracts for the per-form views and wizards.

import type { FilingData, Taxpayer } from "./types";
import type { SetFn } from "./formkit";

/** Props every faithful form view receives. `C` is the form's compute result. */
export interface FormProps<C> {
  tp: Taxpayer | null;
  data: FilingData;
  set: SetFn;
  comp: C;
}

/** Props every guided wizard receives. */
export interface GuidedProps<C> extends FormProps<C> {
  onViewForm: () => void;
  onPrint: () => void;
}
