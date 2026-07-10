import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — primary firm action control.
 * Variants map to README "Interactions": primary navy (→ navy-hover), outline
 * (border darkens to navy on hover), ghost, solid danger, and inline link.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-btn font-sans font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/[0.14] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-navy text-white hover:bg-navy-hover",
        outline:
          "border border-line-input bg-card text-navy hover:border-navy",
        ghost: "bg-transparent text-content-secondary hover:bg-rowhover",
        danger: "bg-danger text-white hover:bg-danger-ink",
        link: "bg-transparent text-blue underline-offset-2 hover:text-navy-hover hover:underline",
      },
      size: {
        sm: "px-4 py-[7px] text-[13px]",
        md: "px-4 py-[10px] text-[13.5px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element (Radix Slot) — e.g. wrap an anchor. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        // A Slot child provides its own element; only set type on real buttons.
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
