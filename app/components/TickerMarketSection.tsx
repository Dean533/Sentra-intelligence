"use client";

import { useEffect, useMemo, useState } from "react";
import MarketPriceChart from "@/app/components/MarketPriceChart";

type MarketRange = "1d" | "5d" | "1mo" | "3mo" | "1y";

type MarketPoint = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

const ranges: MarketRange[] = ["1d", "5d", "1mo", "3mo", "1y"];

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

export default function TickerMarketSection({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<MarketRange>("1y");
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<MarketPoint[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(
          `/api/market/history?ticker=${ticker}&range=${range}`
        );
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Failed to load chart");
        }

        setPoints(json.points || []);
        setMeta(json.meta || null);
      } catch (e: any) {
        setError(e?.message || "Failed to load chart");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [ticker, range]);

  const filtered = useMemo(
    () => points.filter((p) => p.close !== null),
    [points]
  );

  const firstClose =
    filtered.length > 0 ? (filtered[0].close as number | null) : null;
  const lastClose =
    filtered.length > 0
      ? (filtered[filtered.length - 1].close as number | null)
      : null;

  const absoluteChange =
    firstClose !== null && lastClose !== null ? lastClose - firstClose : null;

  const percentChange =
    firstClose !== null &&
    lastClose !== null &&
    firstClose !== 0
      ? (absoluteChange! / firstClose) * 100
      : null;

  const changeColor =
    absoluteChange === null
      ? "#a1a1aa"
      : absoluteChange >= 0
      ? "#4ade80"
      : "#f87171";

  return (
    <section
      style={{
        marginTop: 28,
        border: "1px solid #1f2937",
        borderRadius: 20,
        background:
          "linear-gradient(180deg, rgba(17,24,39,0.85) 0%, rgba(8,10,14,0.95) 100%)",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#9ca3af",
              marginBottom: 8,
            }}
          >
            Market Price
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 700 }}>
              {formatMoney(meta?.regularMarketPrice ?? lastClose)}
            </div>

            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: changeColor,
              }}
            >
              {absoluteChange === null || percentChange === null
                ? "—"
                : `${absoluteChange >= 0 ? "+" : ""}${absoluteChange.toFixed(
                    2
                  )} (${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(
                    2
                  )}%)`}
            </div>
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: "#9ca3af",
            }}
          >
            {meta?.longName || ticker} · {range.toUpperCase()} view
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #2f3746",
                background: r === range ? "#f8fafc" : "#0f1115",
                color: r === range ? "#0b0b0c" : "#e5e7eb",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            border: "1px solid #222833",
            background: "#0d1016",
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 13,
            color: "#d1d5db",
          }}
        >
          Day High: {formatMoney(meta?.regularMarketDayHigh)}
        </div>

        <div
          style={{
            border: "1px solid #222833",
            background: "#0d1016",
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 13,
            color: "#d1d5db",
          }}
        >
          Day Low: {formatMoney(meta?.regularMarketDayLow)}
        </div>

        <div
          style={{
            border: "1px solid #222833",
            background: "#0d1016",
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 13,
            color: "#d1d5db",
          }}
        >
          52W High: {formatMoney(meta?.fiftyTwoWeekHigh)}
        </div>

        <div
          style={{
            border: "1px solid #222833",
            background: "#0d1016",
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 13,
            color: "#d1d5db",
          }}
        >
          52W Low: {formatMoney(meta?.fiftyTwoWeekLow)}
        </div>
      </div>

      {loading ? (
        <div style={{ color: "#9ca3af", padding: "24px 0" }}>
          Loading market chart...
        </div>
      ) : null}

      {error ? (
        <div style={{ color: "#f87171", padding: "24px 0" }}>{error}</div>
      ) : null}

      {!loading && !error ? (
        <MarketPriceChart points={points} range={range} />
      ) : null}
    </section>
  );
}