/**
 * Recharts chart components for the MCRC portal, styled to the design spec:
 * navy income (#0e2a45), gold expenses (#c0902f), beige gridlines (#efe8d8),
 * mono axis labels. The prototype's charts are illustrative statics; here they
 * bind to real (mock) data while keeping the same colours and visual style.
 */
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { peso } from "@/lib/utils";
import type { MonthlyIncomeExpense, RegimeMix } from "@/types";

const NAVY = "#0e2a45";
const GOLD = "#c0902f";
const GRID = "#efe8d8";
const AXIS = "#8a94a0";

const axisTick = {
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 10,
  fill: AXIS,
};

/** Compact peso for axis ticks — ₱1.2M / ₱742k. */
function compactPeso(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `₱${Math.round(value / 1_000)}k`;
  return `₱${value}`;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps): React.JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-btn border border-line-strong bg-card px-3 py-2 shadow-dropdown">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
        {label}
      </div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-[12px] text-content">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          <span className="capitalize text-content-secondary">{entry.name}</span>
          <span className="ml-auto font-mono">{peso(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface IncomeExpensesBarProps {
  data: MonthlyIncomeExpense[];
  height?: number;
}

/** Grouped bar chart — income (navy) vs expenses (gold) over the trailing months. */
export function IncomeExpensesBar({
  data,
  height = 250,
}: IncomeExpensesBarProps): React.JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={6} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={axisTick} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={compactPeso}
        />
        <Tooltip cursor={{ fill: "rgba(14,42,69,0.04)" }} content={<ChartTooltip />} />
        <Bar dataKey="income" name="income" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Bar dataKey="expenses" name="expenses" fill={GOLD} radius={[3, 3, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TrendLineProps {
  data: MonthlyIncomeExpense[];
  height?: number;
}

/** Line chart — income vs expenses trend (client detail + portal home). */
export function TrendLine({ data, height = 220 }: TrendLineProps): React.JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={axisTick} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={compactPeso}
        />
        <Tooltip content={<ChartTooltip />} />
        <Line
          type="monotone"
          dataKey="income"
          name="income"
          stroke={NAVY}
          strokeWidth={2}
          dot={{ r: 2.5, fill: NAVY }}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="expenses"
          name="expenses"
          stroke={GOLD}
          strokeWidth={2}
          dot={{ r: 2.5, fill: GOLD }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface RegimeMixBarProps {
  mix: RegimeMix;
}

/** Segmented horizontal bar — VAT (navy) vs Percentage (gold) client counts. */
export function RegimeMixBar({ mix }: RegimeMixBarProps): React.JSX.Element {
  const total = Math.max(mix.vat + mix.percentage, 1);
  const vatPct = (mix.vat / total) * 100;
  const pctPct = (mix.percentage / total) * 100;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-chip bg-line">
        <div style={{ width: `${vatPct}%`, backgroundColor: NAVY }} aria-hidden="true" />
        <div style={{ width: `${pctPct}%`, backgroundColor: GOLD }} aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-center gap-5 text-[12px] text-content-secondary">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NAVY }} />
          VAT
          <span className="font-mono text-content">{mix.vat}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GOLD }} />
          Percentage
          <span className="font-mono text-content">{mix.percentage}</span>
        </span>
      </div>
    </div>
  );
}
