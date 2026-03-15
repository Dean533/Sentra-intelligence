export type Stance = "bullish" | "bearish" | "neutral";

export function classifyStance(textRaw: string): {
  stance: Stance;
  confidence: number;
} {
  const text = (textRaw || "").toLowerCase();

  const bullish = [
    "buy",
    "bullish",
    "undervalued",
    "going up",
    "breakout",
    "upside",
    "outperform",
    "strong",
    "long",
  ];

  const bearish = [
    "sell",
    "bearish",
    "overvalued",
    "going down",
    "crash",
    "bubble",
    "downside",
    "short",
    "weak",
  ];

  let b = 0;
  let r = 0;

  for (const w of bullish) {
    if (text.includes(w)) b++;
  }

  for (const w of bearish) {
    if (text.includes(w)) r++;
  }

  if (b === 0 && r === 0) {
    return { stance: "neutral", confidence: 0.4 };
  }

  if (b === r) {
    return { stance: "neutral", confidence: 0.5 };
  }

  const stance: Stance = b > r ? "bullish" : "bearish";
  const confidence = Math.min(0.9, 0.55 + Math.abs(b - r) * 0.1);

  return { stance, confidence };
}