import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Serif headline. */
  title: React.ReactNode;
  /** Helper copy under the headline. */
  description?: React.ReactNode;
  /** Optional leading icon/illustration. */
  icon?: React.ReactNode;
  /** CTA slot (buttons), centered under the copy. */
  children?: React.ReactNode;
  /** "dashed" renders the faded dashed-border card used on the dashboard. */
  variant?: "default" | "dashed";
}

/** EmptyState — serif headline + helper + CTA slot. */
export function EmptyState({
  title,
  description,
  icon,
  children,
  variant = "default",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-10 py-16 text-center",
        variant === "dashed" &&
          "rounded-card border border-dashed border-line-strong bg-card/40",
        className,
      )}
      {...props}
    >
      {icon ? <div className="mb-4 text-content-muted">{icon}</div> : null}
      <h3 className="font-serif text-[21px] font-medium text-navy">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-[13.5px] text-content-secondary">
          {description}
        </p>
      ) : null}
      {children ? (
        <div className="mt-[18px] flex items-center justify-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Serif headline (defaults to a generic load-failure message). */
  title?: React.ReactNode;
  /** Cause line under the headline. */
  message?: React.ReactNode;
  /** Retry handler — renders the Retry button when provided. */
  onRetry?: () => void;
  /** Retry button label. */
  retryLabel?: string;
}

/** ErrorState — red alert circle, serif headline, cause line, Retry button. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry",
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center px-10 py-12 text-center", className)}
      {...props}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-3.5 font-serif text-[21px] font-medium text-danger-ink">
        {title}
      </h3>
      {message ? (
        <p className="mt-2 max-w-md text-[13.5px] text-content-secondary">
          {message}
        </p>
      ) : null}
      {onRetry ? (
        <Button
          type="button"
          variant="danger"
          size="sm"
          className="mt-[18px]"
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
