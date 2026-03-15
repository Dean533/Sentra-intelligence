export function isFinanceRelevant(textRaw: string): boolean {
  const text = (textRaw || "").toLowerCase();

  const financeWords = [
    "stock",
    "stocks",
    "shares",
    "market",
    "markets",
    "earnings",
    "revenue",
    "guidance",
    "valuation",
    "price target",
    "analyst",
    "investor",
    "investing",
    "trade",
    "trading",
    "bullish",
    "bearish",
    "portfolio",
    "nasdaq",
    "nyse",
    "company",
    "companies",
    "quarter",
    "q1",
    "q2",
    "q3",
    "q4",
    "financial",
    "tsla",
    "nvda",
    "aapl",
    "msft",
    "amzn",
    "meta",
    "googl",
    "pltr",
    "amd",
    "intel",
    "coin",
  ];

  return financeWords.some((word) => text.includes(word));
}

export function isClearlyIrrelevant(textRaw: string): boolean {
  const text = (textRaw || "").toLowerCase();

  const badWords = [
    "official music video",
    "lyrics",
    "remastered",
    "live at",
    "album",
    "band",
    "tour",
    "concert",
    "guitar",
    "drum cover",
    "karaoke",
    "reaction video",
    "dance video",
  ];

  return badWords.some((word) => text.includes(word));
}