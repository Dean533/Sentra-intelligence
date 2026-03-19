"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Ticker = {
  ticker: string;
  sector?: string | null;
  companyName?: string | null;

  mentions: number | null;
  sentiment: number | null;
  sentraScore: number | null;
  bullishMentions: number | null;
  bearishMentions: number | null;
  neutralMentions: number | null;
  avgConfidence: number | null;
  rawReach?: number | null;

  price?: number | null;
  dayChangePercent?: number | null;
  volume?: number | null;
  marketCap?: number | null;
};

type ViewMode = "market" | "sentra";
type SortKey =
  | "marketCap"
  | "volume"
  | "price"
  | "dayChangePercent"
  | "sentraScore"
  | "mentions"
  | "sentiment"
  | "avgConfidence"
  | "rawReach";

const MARKET_SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "marketCap", label: "Market Cap" },
  { key: "volume", label: "Volume" },
  { key: "price", label: "Price" },
  { key: "dayChangePercent", label: "Day Change" },
  { key: "sentraScore", label: "Sentra Score" },
];

const SENTRA_SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "sentraScore", label: "Sentra Score" },
  { key: "mentions", label: "Mentions" },
  { key: "sentiment", label: "Sentiment" },
  { key: "avgConfidence", label: "Confidence" },
  { key: "rawReach", label: "Signal Reach" },
];

export default function TickersPage() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("market");
  const [sortBy, setSortBy] = useState<SortKey>("marketCap");
  const [selectedSector, setSelectedSector] = useState("All sectors");

  const [sectorMenuOpen, setSectorMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  const router = useRouter();
  const sectorMenuRef = useRef<HTMLDivElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function fetchTickers() {
      try {
        const res = await fetch("/api/tickers");
        const data = await res.json();
        setTickers(data.tickers ?? []);
      } finally {
        setLoading(false);
      }
    }

    fetchTickers();
  }, []);

  useEffect(() => {
    if (viewMode === "market") {
      setSortBy("marketCap");
    } else {
      setSortBy("sentraScore");
    }
  }, [viewMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        sectorMenuRef.current &&
        !sectorMenuRef.current.contains(e.target as Node)
      ) {
        setSectorMenuOpen(false);
      }

      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(e.target as Node)
      ) {
        setSortMenuOpen(false);
      }

      if (
        viewMenuRef.current &&
        !viewMenuRef.current.contains(e.target as Node)
      ) {
        setViewMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();

    const ticker = query.trim().toUpperCase();
    if (!ticker) return;

    router.push(`/t/${ticker}`);
  }

  const activeSortOptions =
    viewMode === "market" ? MARKET_SORT_OPTIONS : SENTRA_SORT_OPTIONS;

  const sectorOptions = useMemo(() => {
    const sectors = Array.from(
      new Set(
        tickers
          .map((t) => t.sector)
          .filter((value): value is string => Boolean(value))
      )
    ).sort();

    return ["All sectors", ...sectors];
  }, [tickers]);

  const filteredAndSortedTickers = useMemo(() => {
    let list = [...tickers];

    if (selectedSector !== "All sectors") {
      list = list.filter((t) => t.sector === selectedSector);
    }

    list.sort((a, b) => {
      if (sortBy === "marketCap") return num(b.marketCap) - num(a.marketCap);
      if (sortBy === "volume") return num(b.volume) - num(a.volume);
      if (sortBy === "price") return num(b.price) - num(a.price);
      if (sortBy === "dayChangePercent") {
        return num(b.dayChangePercent) - num(a.dayChangePercent);
      }
      if (sortBy === "mentions") return num(b.mentions) - num(a.mentions);
      if (sortBy === "sentiment") return num(b.sentiment) - num(a.sentiment);
      if (sortBy === "avgConfidence") {
        return num(b.avgConfidence) - num(a.avgConfidence);
      }
      if (sortBy === "rawReach") return num(b.rawReach) - num(a.rawReach);
      return num(b.sentraScore) - num(a.sentraScore);
    });

    return list.slice(0, 25);
  }, [tickers, selectedSector, sortBy]);

  if (loading) {
    return (
      <div style={{ padding: "48px 40px", color: "#cfcfcf" }}>
        Loading ticker explorer...
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={heroWrap}>
        <div style={eyebrow}>Ticker Explorer</div>

        <h1 style={title}>Explore Tickers</h1>

        <p style={subtitle}>
          Search any ticker directly or browse the top 25 names by sector and metric.
        </p>

        <form onSubmit={handleSearch} style={searchForm}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any ticker..."
            style={searchInput}
          />
          <button type="submit" style={searchButton}>
            Search
          </button>
        </form>

        <div style={controlsRow}>
          <div style={{ position: "relative" }} ref={sectorMenuRef}>
            <button
              type="button"
              onClick={() => setSectorMenuOpen((v) => !v)}
              style={pillButton}
            >
              Sector
              <span style={pillValue}>{selectedSector}</span>
            </button>

            {sectorMenuOpen && (
              <div style={popover}>
                {sectorOptions.map((sector) => {
                  const active = sector === selectedSector;

                  return (
                    <button
                      key={sector}
                      type="button"
                      onClick={() => {
                        setSelectedSector(sector);
                        setSectorMenuOpen(false);
                      }}
                      style={{
                        ...popoverItem,
                        background: active ? "#111827" : "transparent",
                        color: active ? "white" : "#d4d4d8",
                      }}
                    >
                      {sector}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ position: "relative" }} ref={sortMenuRef}>
            <button
              type="button"
              onClick={() => setSortMenuOpen((v) => !v)}
              style={pillButton}
            >
              Top 25 by
              <span style={pillValue}>
                {activeSortOptions.find((o) => o.key === sortBy)?.label}
              </span>
            </button>

            {sortMenuOpen && (
              <div style={popover}>
                {activeSortOptions.map((option) => {
                  const active = option.key === sortBy;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setSortBy(option.key);
                        setSortMenuOpen(false);
                      }}
                      style={{
                        ...popoverItem,
                        background: active ? "#111827" : "transparent",
                        color: active ? "white" : "#d4d4d8",
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ position: "relative" }} ref={viewMenuRef}>
            <button
              type="button"
              onClick={() => setViewMenuOpen((v) => !v)}
              style={pillButton}
            >
              View
              <span style={pillValue}>
                {viewMode === "market" ? "Market" : "Sentra"}
              </span>
            </button>

            {viewMenuOpen && (
              <div style={popover}>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("market");
                    setViewMenuOpen(false);
                  }}
                  style={{
                    ...popoverItem,
                    background: viewMode === "market" ? "#111827" : "transparent",
                    color: viewMode === "market" ? "white" : "#d4d4d8",
                  }}
                >
                  Market View
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode("sentra");
                    setViewMenuOpen(false);
                  }}
                  style={{
                    ...popoverItem,
                    background: viewMode === "sentra" ? "#111827" : "transparent",
                    color: viewMode === "sentra" ? "white" : "#d4d4d8",
                  }}
                >
                  Sentra View
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={listHeader}>
        <div>
          <div style={listTitle}>Top 25 Tickers</div>
          <div style={listMeta}>
            {viewMode === "market"
              ? "Market-first board with Sentra as one signal"
              : "Sentra-specific board with narrative metrics"}
          </div>
        </div>

        <div style={coverageNote}>
          {selectedSector} · Ranked by{" "}
          {activeSortOptions.find((o) => o.key === sortBy)?.label}
        </div>
      </div>

      <div style={tableWrap}>
        <table style={table}>
          <thead>
            {viewMode === "market" ? (
              <tr>
                <th style={th}>Rank</th>
                <th style={th}>Ticker</th>
                <th style={th}>Price</th>
                <th style={th}>Day Change</th>
                <th style={th}>Volume</th>
                <th style={th}>Market Cap</th>
                <th style={th}>Sentra Score</th>
              </tr>
            ) : (
              <tr>
                <th style={th}>Rank</th>
                <th style={th}>Ticker</th>
                <th style={th}>Sentra Score</th>
                <th style={th}>Sentiment</th>
                <th style={th}>Mentions</th>
                <th style={th}>Confidence</th>
                <th style={th}>Signal Reach</th>
              </tr>
            )}
          </thead>

          <tbody>
            {filteredAndSortedTickers.map((t, index) =>
              viewMode === "market" ? (
                <tr key={t.ticker} style={tr}>
                  <td style={tdMuted}>{index + 1}</td>

                  <td style={td}>
                    <Link href={`/t/${t.ticker}`} style={tickerLink}>
                      {t.ticker}
                    </Link>
                    <div style={tickerSubtext}>
                      {t.companyName || t.ticker}
                      {t.sector ? ` · ${t.sector}` : ""}
                    </div>
                  </td>

                  <td style={td}>{formatPrice(t.price)}</td>
                  <td
                    style={{
                      ...td,
                      color:
                        num(t.dayChangePercent) > 0
                          ? "#4ade80"
                          : num(t.dayChangePercent) < 0
                          ? "#f87171"
                          : "white",
                    }}
                  >
                    {formatPercent(t.dayChangePercent)}
                  </td>
                  <td style={td}>{formatLargeNumber(t.volume)}</td>
                  <td style={td}>{formatLargeCurrency(t.marketCap)}</td>
                  <td style={td}>{formatSentra(t.sentraScore)}</td>
                </tr>
              ) : (
                <tr key={t.ticker} style={tr}>
                  <td style={tdMuted}>{index + 1}</td>

                  <td style={td}>
                    <Link href={`/t/${t.ticker}`} style={tickerLink}>
                      {t.ticker}
                    </Link>
                    <div style={tickerSubtext}>
                      {t.companyName || t.ticker}
                      {t.sector ? ` · ${t.sector}` : ""}
                    </div>
                  </td>

                  <td style={td}>{formatSentra(t.sentraScore)}</td>
                  <td style={td}>{formatDecimal(t.sentiment)}</td>
                  <td style={td}>{formatWhole(t.mentions)}</td>
                  <td style={td}>{formatDecimal(t.avgConfidence)}</td>
                  <td style={td}>{formatLargeNumber(t.rawReach)}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function num(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatWhole(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

function formatDecimal(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSentra(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatLargeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";

  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;

  return value.toLocaleString();
}

function formatLargeCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";

  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }

  return `$${value.toLocaleString()}`;
}

const pageWrap: React.CSSProperties = {
  padding: "40px 40px 56px",
  maxWidth: "1420px",
  margin: "0 auto",
};

const heroWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  marginBottom: "28px",
};

const eyebrow: React.CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#7c8493",
  marginBottom: "12px",
};

const title: React.CSSProperties = {
  fontSize: "42px",
  fontWeight: 700,
  color: "white",
  margin: 0,
};

const subtitle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: "15px",
  maxWidth: "700px",
  marginTop: "12px",
  marginBottom: "24px",
  lineHeight: 1.6,
};

const searchForm: React.CSSProperties = {
  width: "100%",
  maxWidth: "760px",
  display: "flex",
  gap: "10px",
  marginBottom: "18px",
};

const searchInput: React.CSSProperties = {
  flex: 1,
  background: "linear-gradient(180deg, #0b0b0f 0%, #11131a 100%)",
  border: "1px solid #222633",
  color: "white",
  padding: "16px 18px",
  borderRadius: "14px",
  fontSize: "16px",
  outline: "none",
};

const searchButton: React.CSSProperties = {
  background: "white",
  color: "black",
  border: "none",
  padding: "0 18px",
  borderRadius: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const controlsRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  marginBottom: "8px",
  flexWrap: "wrap",
};

const pillButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  background: "#0d1017",
  border: "1px solid #232938",
  color: "#d4d4d8",
  padding: "10px 14px",
  borderRadius: "999px",
  cursor: "pointer",
  fontSize: "14px",
};

const pillValue: React.CSSProperties = {
  color: "white",
  fontWeight: 600,
};

const popover: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  minWidth: "220px",
  maxHeight: "320px",
  overflowY: "auto",
  background: "#090b10",
  border: "1px solid #232938",
  borderRadius: "14px",
  padding: "8px",
  boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
  zIndex: 20,
};

const popoverItem: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  border: "none",
  borderRadius: "10px",
  padding: "10px 12px",
  cursor: "pointer",
  fontSize: "14px",
};

const listHeader: React.CSSProperties = {
  marginTop: "26px",
  marginBottom: "14px",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: "12px",
};

const listTitle: React.CSSProperties = {
  color: "white",
  fontSize: "22px",
  fontWeight: 700,
  marginBottom: "4px",
};

const listMeta: React.CSSProperties = {
  color: "#8b93a7",
  fontSize: "14px",
};

const coverageNote: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
};

const tableWrap: React.CSSProperties = {
  border: "1px solid #1f2430",
  borderRadius: "18px",
  overflow: "hidden",
  background: "linear-gradient(180deg, #06080d 0%, #0a0d14 100%)",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "16px 18px",
  color: "#8f98ab",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  borderBottom: "1px solid #1a2030",
};

const tr: React.CSSProperties = {
  borderBottom: "1px solid #141926",
};

const td: React.CSSProperties = {
  padding: "18px",
  color: "white",
  fontSize: "15px",
  verticalAlign: "middle",
};

const tdMuted: React.CSSProperties = {
  padding: "18px",
  color: "#7b8498",
  fontSize: "14px",
  verticalAlign: "middle",
};

const tickerLink: React.CSSProperties = {
  color: "white",
  textDecoration: "none",
  fontWeight: 700,
};

const tickerSubtext: React.CSSProperties = {
  marginTop: "4px",
  color: "#7c8493",
  fontSize: "12px",
};