import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Chip (a.k.a. Badge) — fully-rounded mono status pill. Each variant maps a
 * status foreground/background token pair from the design system.
 */
export const chipVariants = cva(
  "inline-flex items-center rounded-chip font-mono font-semibold leading-none",
  {
    variants: {
      variant: {
        success: "text-success bg-success-bg",
        warn: "text-warn bg-warn-bg",
        danger: "text-danger bg-danger-bg",
        info: "text-info bg-info-bg",
        neutral: "text-neutralchip bg-neutralchip-bg",
        vat: "text-vatchip bg-vatchip-bg",
        gold: "text-gold-deep bg-warn-bg-2",
      },
      size: {
        sm: "text-[10px] px-2 py-[3px]",
        md: "text-[11px] px-[9px] py-[3px]",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm",
    },
  },
);

export type ChipVariant = NonNullable<
  VariantProps<typeof chipVariants>["variant"]
>;

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(chipVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";

/** The two Philippine tax regimes, used across the workspace. */
export type Regime = "VAT" | "PERCENTAGE";

export interface RegimeChipProps
  extends Omit<ChipProps, "variant" | "children"> {
  regime: Regime;
}

/** RegimeChip — VAT (blue vatchip) vs Percentage tax (gold). */
export const RegimeChip = React.forwardRef<HTMLSpanElement, RegimeChipProps>(
  ({ regime, ...props }, ref) => (
    <Chip ref={ref} variant={regime === "VAT" ? "vat" : "gold"} {...props}>
      {regime === "VAT" ? "VAT" : "PERCENTAGE"}
    </Chip>
  ),
);
RegimeChip.displayName = "RegimeChip";

export interface StatusChipProps
  extends Omit<ChipProps, "children"> {
  /** Display label for the status. */
  label: string;
}

/**
 * StatusChip — a labelled chip. Pass an explicit `variant` (tone) mapping the
 * semantic status; defaults to neutral. Keeps status → tone decisions at the
 * call site so screens stay the source of truth.
 */
export const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  ({ label, variant = "neutral", ...props }, ref) => (
    <Chip ref={ref} variant={variant} {...props}>
      {label}
    </Chip>
  ),
);
StatusChip.displayName = "StatusChip";
