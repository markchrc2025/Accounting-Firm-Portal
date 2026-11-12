// pageHeaderSlot - W25: one slot directly under a page's title. PageHeader renders whatever a
// surrounding provider puts here (nothing elsewhere in the Portal). The BIR form editor page
// fills it with the Form details | Preview tabs, so all twelve editors get the tabs under their
// own title without any of them rendering the tabs itself.
import { createContext, type ReactNode } from "react";

export const PageHeaderSlot = createContext<ReactNode>(null);
