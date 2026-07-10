import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Text input — rounded-input, 1px line-input border, blue focus ring
 * (rgba(35,96,200,.14)). Placeholder + disabled styling from the tokens.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "w-full rounded-input border border-line-input bg-card px-[13px] py-[10px] text-sm text-content transition-colors",
      "placeholder:text-content-placeholder",
      "focus-visible:border-blue focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/[0.14]",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
