"use client";

// Client-side Recharts visualizations for the dashboard. Server components pass
// already-computed, integer-cent data; these components only render + format.
//
// Theming: the app switches light/dark via `prefers-color-scheme` (see
// globals.css / tailwind media dark mode). Recharts paints SVG with literal
// color strings — CSS variables don't resolve inside SVG presentation
// attributes — so we read the scheme with matchMedia and pick a small,
// validated palette (greens/reds/neutrals + a CVD-checked categorical ramp for
// the donut). HTML chrome (tooltips) uses CSS vars so it's always theme-correct.

import { useEffect, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/money";

// ---------------------------------------------------------------------------
// Theme + palette
// ---------------------------------------------------------------------------

function buildPalette(dark: boolean) {
  return {
    income: dark ? "#34d399" : "#059669", // emerald 400 / 600
    expense: dark ? "#fb7185" : "#e11d48", // rose 400 / 600
    net: dark ? "#e2e8f0" : "#334155", // slate 200 / 700 (neutral "bottom line")
    grid: dark ? "#262b35" : "#e7e9ee", // matches --border
    axis: dark ? "#9aa2b1" : "#6b7280", // matches --muted
    surface: dark ? "#171a21" : "#ffffff", // matches --card (slice gaps)
    // Green-forward categorical ramp for the spending donut. Both rows are the
    // dataviz-validated steps for their surface band (light ΔE 53.9 / dark 48.8,
    // all-checks-pass); "Other" is an intentional labeled neutral.
    donut: dark
      ? ["#199e70", "#3987e5", "#c98500", "#9085e9", "#d95926", "#d55181"]
      : ["#1baf7a", "#2a78d6", "#eda100", "#4a3aa7", "#eb6834", "#e87ba4"],
    donutOther: "#94a3b8", // slate 400
  };
}

/** Tracks the active color scheme, and whether we've mounted (so Recharts —
 * which must measure the DOM — never renders during SSR). */
function useChartTheme() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return { mounted, colors: buildPalette(dark) };
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-xl"
      style={{ height, background: "color-mix(in srgb, var(--text) 6%, transparent)" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tooltips (HTML — theme-aware via CSS vars)
// ---------------------------------------------------------------------------

type TipEntry = {
  name?: string;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
};

function tipCard(children: ReactNode) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs shadow-lg"
      style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
    >
      {children}
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return tipCard(
    <>
      <div className="mb-1.5 font-semibold">{label}</div>
      <div className="flex flex-col gap-1">
        {payload.map((e) => (
          <div key={String(e.dataKey)} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: e.color }} />
              <span className="muted">{e.name}</span>
            </span>
            <span className="font-medium tabular-nums">{formatMoney(Number(e.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function DonutTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: TipEntry[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const val = Number(p.value ?? 0);
  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
  const fill = (p.payload?.fill as string) || p.color;
  return tipCard(
    <div className="flex items-center gap-2">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: fill }} />
      <span className="font-semibold">{p.name}</span>
      <span className="muted tabular-nums">
        {formatMoney(val)} · {pct}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend: Income vs Expenses (paired bars) + Net (line)
// ---------------------------------------------------------------------------

export interface TrendDatum {
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

const TREND_HEIGHT = 264;

function LegendDot({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {line ? (
        <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: color }} />
      ) : (
        <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      )}
      <span className="muted text-xs font-medium">{label}</span>
    </span>
  );
}

export function TrendChart({ data }: { data: TrendDatum[] }) {
  const { mounted, colors } = useChartTheme();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <LegendDot color={colors.income} label="Income" />
        <LegendDot color={colors.expense} label="Expenses" />
        <LegendDot color={colors.net} label="Net" line />
      </div>
      <div role="img" aria-label="Income versus expenses over the last six months">
        {!mounted ? (
          <ChartSkeleton height={TREND_HEIGHT} />
        ) : (
          <ResponsiveContainer width="100%" height={TREND_HEIGHT}>
            <ComposedChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barGap={4}>
              <defs>
                <linearGradient id="bbIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.income} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={colors.income} stopOpacity={0.72} />
                </linearGradient>
                <linearGradient id="bbExpense" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.expense} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={colors.expense} stopOpacity={0.72} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                dy={8}
                tick={{ fill: colors.axis, fontSize: 12 }}
              />
              <YAxis
                width={52}
                tickLine={false}
                axisLine={false}
                tick={{ fill: colors.axis, fontSize: 12 }}
                tickFormatter={(v) => formatMoneyCompact(Number(v))}
              />
              <ReferenceLine y={0} stroke={colors.axis} strokeOpacity={0.5} />
              <Tooltip
                cursor={{ fill: colors.axis, fillOpacity: 0.08 }}
                content={<TrendTooltip />}
                wrapperStyle={{ outline: "none" }}
              />
              <Bar dataKey="incomeCents" name="Income" fill="url(#bbIncome)" radius={[5, 5, 0, 0]} maxBarSize={26} />
              <Bar dataKey="expenseCents" name="Expenses" fill="url(#bbExpense)" radius={[5, 5, 0, 0]} maxBarSize={26} />
              <Line
                type="monotone"
                dataKey="netCents"
                name="Net"
                stroke={colors.net}
                strokeWidth={2}
                dot={{ r: 4, fill: colors.net, stroke: colors.surface, strokeWidth: 1.5 }}
                activeDot={{ r: 6, stroke: colors.surface, strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spending donut (top categories + Other) with center total + legend
// ---------------------------------------------------------------------------

export interface DonutDatum {
  name: string;
  amountCents: number;
}

const DONUT_SIZE = 200;

export function CategoryDonut({ data }: { data: DonutDatum[] }) {
  const { mounted, colors } = useChartTheme();
  const total = data.reduce((n, d) => n + d.amountCents, 0);

  const colorFor = (d: DonutDatum, i: number) =>
    d.name === "Other" ? colors.donutOther : colors.donut[i % colors.donut.length];

  const chartData = data.map((d, i) => ({ ...d, fill: colorFor(d, i) }));

  if (!data.length) {
    return (
      <div
        className="grid place-items-center rounded-xl text-center text-sm"
        style={{ height: DONUT_SIZE }}
      >
        <span className="muted">No spending recorded yet this month.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Donut + center total */}
      <div
        className="relative mx-auto shrink-0"
        style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
        role="img"
        aria-label="Spending by category this month"
      >
        {!mounted ? (
          <div
            className="h-full w-full animate-pulse rounded-full"
            style={{ background: "color-mix(in srgb, var(--text) 6%, transparent)" }}
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="amountCents"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="64%"
                  outerRadius="94%"
                  paddingAngle={2}
                  stroke={colors.surface}
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                >
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip total={total} />} wrapperStyle={{ outline: "none" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="text-lg font-semibold tabular-nums">{formatMoney(total, { showCents: false })}</div>
                <div className="muted text-[11px] uppercase tracking-wide">spent</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Legend / data list */}
      <ul className="grid w-full gap-1.5">
        {chartData.map((d, i) => {
          const pct = total > 0 ? Math.round((d.amountCents / total) * 100) : 0;
          return (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.fill }} />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatMoney(d.amountCents, { showCents: false })}
              </span>
              <span className="muted w-9 shrink-0 text-right text-xs tabular-nums">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
