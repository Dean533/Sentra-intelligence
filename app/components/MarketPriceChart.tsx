"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MarketRange = "1d" | "5d" | "1mo" | "3mo" | "1y";

type Point = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

function formatAxisLabel(dateString: string, range: MarketRange) {
  const date = new Date(dateString);

  if (range === "1d" || range === "5d") {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (range === "1y") {
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatTooltipDate(dateString: string, range: MarketRange) {
  const date = new Date(dateString);

  if (range === "1d" || range === "5d") {
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CustomTooltip({
  active,
  payload,
  label,
  range,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  range: MarketRange;
}) {
  if (!active || !payload || !payload.length) return null;

  const price = payload[0]?.value;

  return (
    <div
      style={{
        background: "#0f1115",
        border: "1px solid #2a2f3a",
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        color: "#fff",
        minWidth: 150,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "#a1a1aa",
          marginBottom: 6,
        }}
      >
        {label ? formatTooltipDate(label, range) : ""}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "#ffffff",
        }}
      >
        ${Number(price).toFixed(2)}
      </div>
    </div>
  );
}

export default function MarketPriceChart({
  points,
  range,
}: {
  points: Point[];
  range: MarketRange;
}) {
  const chartData = points
    .filter((p) => p.close !== null && p.date)
    .map((p) => ({
      date: p.date,
      close: p.close as number,
    }));

  return (
    <div
      style={{
        width: "100%",
        height: 460,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9ecbff" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#9ecbff" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#1a1d24" vertical={false} />

          <XAxis
            dataKey="date"
            tickFormatter={(value) => formatAxisLabel(value, range)}
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            axisLine={{ stroke: "#2a2f3a" }}
            tickLine={false}
            minTickGap={28}
          />

          <YAxis
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            axisLine={{ stroke: "#2a2f3a" }}
            tickLine={false}
            domain={["auto", "auto"]}
            width={56}
            tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
          />

          <Tooltip
            content={<CustomTooltip range={range} />}
            cursor={{ stroke: "#3b4252", strokeWidth: 1 }}
          />

          <Area
            type="monotone"
            dataKey="close"
            stroke="#f8fafc"
            strokeWidth={2.5}
            fill="url(#priceFill)"
            dot={false}
            activeDot={{
              r: 5,
              stroke: "#ffffff",
              strokeWidth: 2,
              fill: "#111827",
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}