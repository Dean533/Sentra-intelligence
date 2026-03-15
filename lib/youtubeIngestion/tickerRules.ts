import { escapeRegex } from "@/lib/youtubeIngestion/shared";

export type TickerRule = {
  aliases: string[];
  strongFinancePhrases: string[];
  negativePhrases: string[];
  minScore: number;
  allowBareAlias: boolean;
};

export const TICKER_RULES: Record<string, TickerRule> = {
  TSLA: {
    aliases: ["tesla"],
    strongFinancePhrases: [
      "tesla stock",
      "tsla stock",
      "tesla shares",
      "tesla earnings",
      "tesla revenue",
      "tesla profit",
      "tesla margins",
      "tesla valuation",
      "tesla investor",
      "tesla investors",
      "tesla analyst",
      "tesla price target",
      "tesla financial results",
      "tsla earnings",
      "tsla valuation",
      "tsla analysis",
      "tsla stock analysis",
    ],
    negativePhrases: [
      "model s",
      "model 3",
      "model x",
      "model y",
      "plaid",
      "test drive",
      "road trip",
      "drag race",
      "charging test",
      "charging review",
      "owner review",
      "tesla review",
      "tesla accessories",
      "tesla mods",
      "tesla delivery",
      "tesla wrap",
      "lamborghini vs tesla",
      "unlock my tesla",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  NVDA: {
    aliases: ["nvidia"],
    strongFinancePhrases: [
      "nvidia stock",
      "nvda stock",
      "nvidia earnings",
      "nvidia valuation",
      "nvidia analysis",
      "nvidia revenue",
      "nvidia price target",
    ],
    negativePhrases: [
      "gpu benchmark",
      "graphics card review",
      "gaming benchmark",
      "pc build",
      "fps test",
      "rtx",
    ],
    minScore: 5,
    allowBareAlias: false,
  },

  AAPL: {
    aliases: ["apple"],
    strongFinancePhrases: [
      "apple stock",
      "aapl stock",
      "apple earnings",
      "apple valuation",
      "apple analysis",
      "apple revenue",
      "apple price target",
    ],
    negativePhrases: [
      "iphone review",
      "ipad review",
      "macbook review",
      "apple watch review",
      "airpods review",
      "ios review",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  MSFT: {
    aliases: ["microsoft"],
    strongFinancePhrases: [
      "microsoft stock",
      "msft stock",
      "microsoft earnings",
      "microsoft valuation",
      "microsoft analysis",
      "microsoft revenue",
      "microsoft price target",
    ],
    negativePhrases: [
      "windows tutorial",
      "excel tutorial",
      "word tutorial",
      "microsoft teams tutorial",
      "xbox review",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  AMZN: {
    aliases: ["amazon"],
    strongFinancePhrases: [
      "amazon stock",
      "amzn stock",
      "amazon earnings",
      "amazon valuation",
      "amazon analysis",
      "amazon revenue",
      "amazon price target",
    ],
    negativePhrases: [
      "amazon haul",
      "amazon finds",
      "amazon products",
      "amazon shopping",
      "amazon gadgets",
      "amazon must haves",
      "amazon prime show",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  META: {
    aliases: ["meta", "facebook"],
    strongFinancePhrases: [
      "meta stock",
      "meta earnings",
      "meta valuation",
      "meta analysis",
      "meta revenue",
      "meta price target",
      "facebook stock",
      "meta platforms stock",
    ],
    negativePhrases: [
      "facebook marketplace",
      "instagram tutorial",
      "whatsapp tutorial",
      "vr headset review",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  GOOGL: {
    aliases: ["google", "alphabet"],
    strongFinancePhrases: [
      "google stock",
      "alphabet stock",
      "googl stock",
      "google earnings",
      "alphabet earnings",
      "google valuation",
      "alphabet valuation",
      "google analysis",
      "alphabet analysis",
    ],
    negativePhrases: [
      "google pixel review",
      "android review",
      "youtube tutorial",
      "gmail tutorial",
      "chrome tutorial",
      "google nest",
      "nest mini",
      "google home",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  NFLX: {
    aliases: ["netflix"],
    strongFinancePhrases: [
      "netflix stock",
      "nflx stock",
      "netflix earnings",
      "netflix valuation",
      "netflix analysis",
    ],
    negativePhrases: [
      "netflix review",
      "movie review",
      "series review",
      "episode review",
    ],
    minScore: 6,
    allowBareAlias: false,
  },
AMD: {
  aliases: ["amd", "advanced micro devices"],
  strongFinancePhrases: [
    "amd stock",
    "amd earnings",
    "amd valuation",
    "amd analysis",
    "amd price target",
    "amd forecast",
    "advanced micro devices stock",
    "advanced micro devices earnings",
  ],
  negativePhrases: [
    "not amd",
    "without amd",
    "ryzen review",
    "cpu benchmark",
    "gaming benchmark",
    "pc build",
    "overclock",
    "gpu benchmark",
    "driver install",
    "bios update",
  ],
  minScore: 7,
  allowBareAlias: false,
},

  INTC: {
    aliases: ["intel"],
    strongFinancePhrases: [
      "intel stock",
      "intc stock",
      "intel earnings",
      "intel valuation",
      "intel analysis",
    ],
    negativePhrases: [
      "cpu benchmark",
      "gaming benchmark",
      "intel arc review",
      "pc build",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  COIN: {
    aliases: ["coinbase"],
    strongFinancePhrases: [
      "coinbase stock",
      "coin stock",
      "coinbase earnings",
      "coinbase valuation",
      "coinbase analysis",
    ],
    negativePhrases: [
      "how to use coinbase",
      "coinbase tutorial",
      "crypto wallet tutorial",
    ],
    minScore: 6,
    allowBareAlias: false,
  },

  PLTR: {
    aliases: ["palantir"],
    strongFinancePhrases: [
      "palantir stock",
      "pltr stock",
      "palantir earnings",
      "palantir valuation",
      "palantir analysis",
      "palantir price target",
    ],
    negativePhrases: [],
    minScore: 5,
    allowBareAlias: false,
  },
};

const GENERIC_FINANCE_CONTEXT = [
  "stock",
  "stocks",
  "shares",
  "earnings",
  "revenue",
  "guidance",
  "valuation",
  "price target",
  "analyst",
  "investor",
  "investing",
  "financial",
  "market cap",
  "quarter",
  "q1",
  "q2",
  "q3",
  "q4",
  "bullish",
  "bearish",
  "buy",
  "sell",
  "outlook",
  "forecast",
  "results",
  "company",
  "companies",
];

function includesWholeWord(text: string, phrase: string) {
  const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i");
  return re.test(text);
}

function countMatches(text: string, phrases: string[]) {
  let count = 0;
  for (const phrase of phrases) {
    if (includesWholeWord(text, phrase)) count += 1;
  }
  return count;
}

function hasFinanceContext(text: string) {
  return GENERIC_FINANCE_CONTEXT.some((word) => includesWholeWord(text, word));
}

function scoreTickerEvidence(
  titleRaw: string,
  descriptionRaw: string,
  ticker: string,
  rule: TickerRule
) {
const title = (titleRaw || "").toLowerCase();
const description = (descriptionRaw || "").toLowerCase();

const titleNegativeHits = countMatches(title, rule.negativePhrases);
if (titleNegativeHits > 0) {
  return -999;
}

let score = 0;

  if (title.includes(`$${ticker.toLowerCase()}`)) score += 8;
  if (description.includes(`$${ticker.toLowerCase()}`)) score += 6;

  if (includesWholeWord(title, ticker.toLowerCase())) score += 7;
  if (includesWholeWord(description, ticker.toLowerCase()) && hasFinanceContext(description)) {
    score += 4;
  }

  const aliasInTitle = rule.aliases.some((alias) => includesWholeWord(title, alias));
  const aliasInDescription = rule.aliases.some((alias) =>
    includesWholeWord(description, alias)
  );

  if (rule.allowBareAlias) {
    if (aliasInTitle) score += 3;
    if (aliasInDescription && hasFinanceContext(description)) score += 2;
  }

  if (aliasInTitle) score += 4;

  if (aliasInDescription && hasFinanceContext(description)) {
    score += 2;
  }

  const strongTitleHits = countMatches(title, rule.strongFinancePhrases);
  const strongDescriptionHits = countMatches(description, rule.strongFinancePhrases);

  score += strongTitleHits * 5;
  score += strongDescriptionHits * 3;

  if ((aliasInTitle || includesWholeWord(title, ticker.toLowerCase())) && hasFinanceContext(title)) {
    score += 3;
  }

  if ((aliasInDescription || includesWholeWord(description, ticker.toLowerCase())) && hasFinanceContext(description)) {
    score += 1;
  }

  const negativeHits =
    countMatches(title, rule.negativePhrases) +
    countMatches(description, rule.negativePhrases);

  score -= negativeHits * 5;

  return score;
}

export function extractTickersFromText(
  titleRaw: string,
  descriptionRaw: string
): string[] {
  const title = (titleRaw || "").replace(/\s+/g, " ").trim();
  const description = (descriptionRaw || "").replace(/\s+/g, " ").trim();

  if (!title && !description) return [];

  const found = new Set<string>();

  for (const m of title.matchAll(/\$([A-Z]{1,5})\b/g)) {
    const ticker = m[1].toUpperCase();
    if (TICKER_RULES[ticker]) found.add(ticker);
  }

  for (const m of description.matchAll(/\$([A-Z]{1,5})\b/g)) {
    const ticker = m[1].toUpperCase();
    if (TICKER_RULES[ticker] && hasFinanceContext(description.toLowerCase())) {
      found.add(ticker);
    }
  }

  for (const [ticker, rule] of Object.entries(TICKER_RULES)) {
    const tickerInTitle = includesWholeWord(title, ticker);
    const tickerInDescription = includesWholeWord(description, ticker);

    const aliasInTitle = rule.aliases.some((alias) => includesWholeWord(title, alias));
    const aliasInDescription = rule.aliases.some((alias) =>
      includesWholeWord(description, alias)
    );

    if (tickerInTitle || aliasInTitle) {
      found.add(ticker);
      continue;
    }

    if ((tickerInDescription || aliasInDescription) && hasFinanceContext(description.toLowerCase())) {
      found.add(ticker);
    }
  }

  const accepted: string[] = [];

  for (const ticker of found) {
    const rule = TICKER_RULES[ticker];
    if (!rule) continue;

    const evidenceScore = scoreTickerEvidence(title, description, ticker, rule);
    if (evidenceScore >= rule.minScore) {
      accepted.push(ticker);
    }
  }

  return accepted;
}