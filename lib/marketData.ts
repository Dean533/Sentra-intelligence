import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export type MarketRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";

export type MarketPoint = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

function getStartDate(range: MarketRange) {
  const now = new Date();
  const start = new Date(now);

  switch (range) {
    case "1d":
      // Look back far enough to span a weekend/holiday; trimmed to the last session below.
      start.setDate(now.getDate() - 5);
      return { period1: start, interval: "5m" as const };

    case "5d":
      // Labelled "1W" in the UI: one calendar week.
      start.setDate(now.getDate() - 7);
      return { period1: start, interval: "15m" as const };

    case "1mo":
      start.setMonth(now.getMonth() - 1);
      return { period1: start, interval: "1d" as const };

    case "3mo":
      start.setMonth(now.getMonth() - 3);
      return { period1: start, interval: "1d" as const };

    case "6mo":
      start.setMonth(now.getMonth() - 6);
      return { period1: start, interval: "1d" as const };

    case "1y":
      start.setFullYear(now.getFullYear() - 1);
      return { period1: start, interval: "1d" as const };

    case "5y":
      start.setFullYear(now.getFullYear() - 5);
      return { period1: start, interval: "1wk" as const };

    case "max":
      return { period1: new Date("1970-01-02"), interval: "1mo" as const };

    default:
      start.setMonth(now.getMonth() - 1);
      return { period1: start, interval: "1d" as const };
  }
}

export async function getMarketHistory(
  ticker: string,
  selectedRange: MarketRange = "1mo"
) {
  const symbol = ticker.toUpperCase().trim();
  const { period1, interval } = getStartDate(selectedRange);

  const result: any = await yahooFinance.chart(symbol, {
    period1,
    interval,
    includePrePost: false,
  });

  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];

  let points: MarketPoint[] = quotes.map((q: any) => ({
    date: q?.date ? new Date(q.date).toISOString() : "",
    open: q?.open ?? null,
    high: q?.high ?? null,
    low: q?.low ?? null,
    close: q?.close ?? null,
    volume: q?.volume ?? null,
  }));

  // 1D = the most recent trading session only (by New York calendar date).
  if (selectedRange === "1d" && points.length) {
    const nyDay = (iso: string) =>
      new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const last = nyDay(points[points.length - 1].date);
    points = points.filter((p) => p.date && nyDay(p.date) === last);
  }

  return {
    symbol,
    range: selectedRange,
    points,
    meta: result?.meta ?? null,
  };
}