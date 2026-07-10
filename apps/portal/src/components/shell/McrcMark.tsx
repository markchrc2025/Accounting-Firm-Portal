import * as React from "react";

/**
 * MCRC shield mark, inlined from the prototype (`assets/MCRC-mark-color.svg`).
 * Navy shield + gold triple-chevron. Two treatments:
 *  - `light` (default): solid navy shield for the cream sidebar.
 *  - `navy`: translucent shield + gold outline for the navy sidebar.
 *
 * Colours here are part of the brand asset itself (the mark's own palette), not
 * theming tokens, so they stay literal — as in the source SVG.
 */
export interface McrcMarkProps {
  variant?: "light" | "navy";
  size?: number;
  className?: string;
}

export function McrcMark({
  variant = "light",
  size = 30,
  className,
}: McrcMarkProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {variant === "light" ? (
        <path
          d="M60 8 L103 23 L103 58 C103 85 84 103 60 113 C36 103 17 85 17 58 L17 23 Z"
          fill="#0e2a45"
        />
      ) : (
        <>
          <path
            d="M60 8 L103 23 L103 58 C103 85 84 103 60 113 C36 103 17 85 17 58 L17 23 Z"
            fill="rgba(255,255,255,0.08)"
          />
          <path
            d="M60 18 L95 30 L95 58 C95 80 80 95 60 103 C40 95 25 80 25 58 L25 30 Z"
            stroke="rgba(230,200,124,0.55)"
            strokeWidth="1.6"
            fill="none"
          />
        </>
      )}
      <path
        d="M42 81 L60 71 L78 81"
        stroke="#c79433"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M45 59 L60 50 L75 59"
        stroke="#dcab46"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M48 38 L60 30 L72 38"
        stroke="#efd084"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
