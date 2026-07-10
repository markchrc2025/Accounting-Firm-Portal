import * as React from "react";

import { cn } from "@/lib/utils";

/** Multiline input — matches Input styling with a comfortable min height. */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-input border border-line-input bg-card px-[13px] py-[10px] text-sm text-content transition-colors",
      "min-h-[84px] resize-y",
      "placeholder:text-content-placeholder",
      "focus-visible:border-blue focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/[0.14]",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
