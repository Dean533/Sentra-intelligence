"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Ticker = {
  ticker: string;
  mentions: number;
  sentiment: number;
  sentraScore: number;
  bullishMentions: number;
  bearishMentions: number;
  neutralMentions: number;
  avgConfidence: number;
};

export default function TickersPage() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTickers() {
      const res = await fetch("/api/tickers");
      const data = await res.json();

      setTickers(
        (data.tickers ?? []).sort(
          (a: Ticker, b: Ticker) => b.sentraScore - a.sentraScore
        )
      );

      setLoading(false);
    }

    fetchTickers();
  }, []);

  if (loading) {
    return <div style={{ padding: "40px" }}>Loading Sentra ticker signals...</div>;
  }

  return (
    <div style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        Sentra Ticker Signals
      </h1>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Ticker</th>
            <th style={th}>Sentra Score</th>
            <th style={th}>Mentions</th>
            <th style={th}>Sentiment</th>
          </tr>
        </thead>

        <tbody>
          {tickers.map((t) => (
            <tr key={t.ticker}>
              <td style={td}>
                <Link href={`/t/${t.ticker}`}>{t.ticker}</Link>
              </td>

              <td style={td}>{t.sentraScore?.toLocaleString()}</td>
              <td style={td}>{t.mentions}</td>
              <td style={td}>{t.sentiment.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th = {
  borderBottom: "1px solid #ccc",
  textAlign: "left" as const,
  padding: "10px",
};

const td = {
  borderBottom: "1px solid #eee",
  padding: "10px",
};