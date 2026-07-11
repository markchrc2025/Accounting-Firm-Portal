/**
 * Minimal MCRC design-system kit for apps/web (the live app). Self-contained — no
 * external class libraries — so it drops in without new dependencies. Components
 * reference the design tokens from tailwind.config.js (never raw hex).
 */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

/** Tiny class combiner (join truthy classes). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Peso currency, always mono + 2 decimals (design token: `₱1,234,567.00`). */
export function peso(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : (amount ?? 0);
  if (Number.isNaN(n)) return "₱0.00";
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "link";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-navy text-white hover:bg-navy-hover",
  outline: "border border-line-input bg-card text-navy hover:border-navy",
  ghost: "bg-transparent text-content-secondary hover:bg-rowhover",
  danger: "bg-danger text-white hover:bg-[#932c25]",
  link: "bg-transparent text-blue underline-offset-2 hover:text-navy-hover hover:underline",
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-[7px] text-[13px]",
  md: "px-4 py-[10px] text-[13.5px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-btn font-semibold transition-colors",
        "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-line-strong bg-card", className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 border-b border-line px-6 py-4", className)}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-serif text-[15px] font-semibold text-navy", className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...props} />;
}

/* -------------------------------------------------------------------- Chip */

export type ChipVariant = "success" | "warn" | "danger" | "info" | "neutral" | "vat" | "gold";

const CHIP_VARIANTS: Record<ChipVariant, string> = {
  success: "text-success bg-success-bg",
  warn: "text-warn bg-warn-bg",
  danger: "text-danger bg-danger-bg",
  info: "text-info bg-info-bg",
  neutral: "text-neutralchip bg-neutralchip-bg",
  vat: "text-vatchip bg-vatchip-bg",
  gold: "text-gold-deep bg-warn-bg-2",
};

export function Chip({
  variant = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: ChipVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-[9px] py-[3px] font-mono text-[10px] font-semibold leading-none",
        CHIP_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function StatusChip({ label, variant = "neutral" }: { label: string; variant?: ChipVariant }) {
  return <Chip variant={variant}>{label}</Chip>;
}

/** Regime chip — VAT (blue) vs Percentage tax (gold). Accepts any tax-type string. */
export function RegimeChip({ regime }: { regime?: string | null }) {
  const isVat = (regime ?? "").toUpperCase().includes("VAT") && !(regime ?? "").toUpperCase().includes("NON");
  const isPct = (regime ?? "").toUpperCase().includes("PERCENT");
  if (!regime) return <span className="text-content-muted">—</span>;
  return <Chip variant={isVat ? "vat" : isPct ? "gold" : "neutral"}>{regime}</Chip>;
}

/* ------------------------------------------------------------- PageHeader */

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-5">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h1 className="font-serif text-[30px] font-medium text-navy">{title}</h1>
        {description ? (
          <div className="mt-1.5 text-[13.5px] text-content-secondary">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ States */

export function EmptyState({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-10 py-16 text-center">
      <h3 className="font-serif text-[21px] font-medium text-navy">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-[13.5px] text-content-secondary">{description}</p>
      ) : null}
      {children ? <div className="mt-[18px] flex items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
}: {
  message?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-10 py-12 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger text-[18px] font-bold text-white">
        !
      </span>
      <h3 className="mt-3.5 font-serif text-[21px] font-medium text-danger-ink">
        Couldn&apos;t load this
      </h3>
      <p className="mt-2 max-w-md text-[13.5px] text-content-secondary">{message}</p>
      {onRetry ? (
        <Button variant="danger" size="sm" className="mt-[18px]" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("h-4 w-full animate-pulse rounded bg-line", className)} />;
}
