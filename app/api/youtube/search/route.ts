import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_CHANNEL_IDS } from "@/lib/allowedChannels";

type Stance = "bullish" | "bearish" | "neutral";

function dedupeByKey<T>(items: T[], keyFn: (x: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(keyFn(item), item);
  return Array.from(map.values());
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

const COMPANY_TO_TICKER: Record<string, string> = {
  nvidia: "NVDA",
  apple: "AAPL",
  microsoft: "MSFT",
  amazon: "AMZN",
  meta: "META",
  google: "GOOGL",
  alphabet: "GOOGL",
  netflix: "NFLX",
  amd: "AMD",
  intel: "INTC",
  coinbase: "COIN",
  palantir: "PLTR",
};

function extractTickersFromText(textRaw: string): string[] {
  const text = (textRaw || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const found = new Set<string>();
  const lower = text.toLowerCase();

  // 1) Explicit ticker symbols like $TSLA
  for (const m of text.matchAll(/\$([A-Z]{1,5})\b/g)) {
    found.add(m[1].toUpperCase());
  }

  // 2) Generic company-name mapping (except Tesla)
  for (const [name, ticker] of Object.entries(COMPANY_TO_TICKER)) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    if (re.test(lower)) found.add(ticker.toUpperCase());
  }

  // 3) Special Tesla handling: only map to TSLA if finance context exists
  const hasTeslaWord = /\btesla\b/i.test(lower);
  const teslaFinanceContext = [
    "stock",
    "shares",
    "earnings",
    "investor",
    "investing",
    "valuation",
    "price target",
    "market cap",
    "analyst",
    "tsla",
    "$tsla",
    "q1",
    "q2",
    "q3",
    "q4",
    "financial results",
  ].some((word) => lower.includes(word));

  if (hasTeslaWord && teslaFinanceContext) {
    found.add("TSLA");
  }

  return Array.from(found);
}

function isFinanceRelevant(textRaw: string): boolean {
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

function isClearlyIrrelevant(textRaw: string): boolean {
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

function classifyStance(textRaw: string): { stance: Stance; confidence: number } {
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

  for (const w of bullish) if (text.includes(w)) b++;
  for (const w of bearish) if (text.includes(w)) r++;

  if (b === 0 && r === 0) return { stance: "neutral", confidence: 0.4 };
  if (b === r) return { stance: "neutral", confidence: 0.5 };

  const stance: Stance = b > r ? "bullish" : "bearish";
  const confidence = Math.min(0.9, 0.55 + Math.abs(b - r) * 0.1);

  return { stance, confidence };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const maxResults = Number(searchParams.get("maxResults") || "10");

    if (!q) {
      return NextResponse.json({ error: "Missing q" }, { status: 400 });
    }

    const youtube = google.youtube({
      version: "v3",
      auth: process.env.YOUTUBE_API_KEY,
    });

    const supabase = supabaseAdmin();

    const financeQuery = `${q} stock OR investing OR earnings OR analysis OR market`;

    const searchRes = await youtube.search.list({
      part: ["snippet"],
      q: financeQuery,
      maxResults,
      type: ["video"],
    });

    const rawItems = searchRes.data.items ?? [];

    const items = rawItems.filter((it) => {
      const sn = it.snippet!;
      const combined = `${sn.title ?? ""} ${sn.description ?? ""}`;

      if (!ALLOWED_CHANNEL_IDS.includes(sn.channelId || "")) return false;
      if (isClearlyIrrelevant(combined)) return false;
      if (!isFinanceRelevant(combined)) return false;

      return true;
    });

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        q,
        creatorsUpserted: 0,
        videosUpserted: 0,
        positionsUpserted: 0,
      });
    }

    const youtubeVideoIds = items
      .map((it) => it.id?.videoId)
      .filter(Boolean) as string[];

    const statsRes = await youtube.videos.list({
      part: ["statistics"],
      id: youtubeVideoIds,
    });

    const statsMap = new Map<string, { view_count: number; like_count: number }>();

    for (const v of statsRes.data.items ?? []) {
      if (!v.id) continue;

      statsMap.set(v.id, {
        view_count: Number(v.statistics?.viewCount ?? 0),
        like_count: Number(v.statistics?.likeCount ?? 0),
      });
    }

    const creatorsRaw = items.map((it) => ({
      youtube_channel_id: it.snippet!.channelId!,
      name: it.snippet!.channelTitle || null,
    }));

    const creators = dedupeByKey(creatorsRaw, (c) => c.youtube_channel_id);

    await supabase
      .from("creators")
      .upsert(creators, { onConflict: "youtube_channel_id" });

    const { data: creatorRows } = await supabase
      .from("creators")
      .select("id,youtube_channel_id")
      .in("youtube_channel_id", creators.map((c) => c.youtube_channel_id));

    const channelToCreator = new Map<string, number>();
    creatorRows?.forEach((r) => channelToCreator.set(r.youtube_channel_id, r.id));

    const videosRaw = items.map((it) => {
      const id = it.id!.videoId!;
      const stats = statsMap.get(id) ?? { view_count: 0, like_count: 0 };

      return {
        youtube_video_id: id,
        creator_id: channelToCreator.get(it.snippet!.channelId!) ?? null,
        title: it.snippet!.title || null,
        description: it.snippet!.description || null,
        video_published_at: it.snippet!.publishedAt ?? null,
        view_count: stats.view_count,
        like_count: stats.like_count,
      };
    });

    const videos = dedupeByKey(videosRaw, (v) => v.youtube_video_id);

    await supabase
      .from("videos")
      .upsert(videos, {
        onConflict: "youtube_video_id",
        ignoreDuplicates: false,
      });

    const { data: videoRows } = await supabase
      .from("videos")
      .select("id,youtube_video_id,creator_id")
      .in("youtube_video_id", videos.map((v) => v.youtube_video_id));

    const videoMap = new Map<string, any>();
    videoRows?.forEach((v) => videoMap.set(v.youtube_video_id, v));

    const positions: any[] = [];

    for (const it of items) {
      const internal = videoMap.get(it.id!.videoId!);
      if (!internal) continue;

      const text = `${it.snippet!.title} ${it.snippet!.description}`;
      const tickers = extractTickersFromText(text);

      if (tickers.length === 0) continue;
      if (!isFinanceRelevant(text)) continue;
      if (isClearlyIrrelevant(text)) continue;

      const { stance, confidence } = classifyStance(text);

      for (const ticker of tickers) {
        positions.push({
          video_id: internal.id,
          creator_id: internal.creator_id,
          ticker,
          stance,
          confidence,
          source: "youtube_search",
          video_published_at: it.snippet!.publishedAt ?? null,
        });
      }
    }

    const cleanPositions = dedupeByKey(
      positions.map((p) => ({ ...p, ticker: p.ticker.toUpperCase() })),
      (p) => `${p.video_id}:${p.ticker}`
    );

    if (cleanPositions.length > 0) {
      await supabase
        .from("video_positions")
        .upsert(cleanPositions, { onConflict: "video_id,ticker" });
    }

    return NextResponse.json({
      success: true,
      q,
      creatorsUpserted: creators.length,
      videosUpserted: videos.length,
      positionsUpserted: cleanPositions.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}