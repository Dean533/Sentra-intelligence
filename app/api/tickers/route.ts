import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { supabaseServer } from "@/lib/supabase/server";
import { computeVideoSentraScore } from "@/lib/sentraScore";
import { TICKER_UNIVERSE } from "@/lib/tickerUniverse";

const yahooFinance = new YahooFinance();

function hasUsableStats(video: any, row: any) {
  const publishedAt =
    video?.video_published_at ??
    video?.published_at ??
    row?.video_published_at ??
    null;

  return video && video.view_count !== null && publishedAt !== null;
}

function toNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function GET() {
  try {
    const supabase = supabaseServer();

    const { data, error } = await supabase.from("video_positions").select(`
      ticker,
      stance,
      confidence,
      video_id,
      video_published_at,
      videos (
        id,
        title,
        view_count,
        like_count,
        comment_count,
        video_published_at,
        published_at,
        youtube_video_id
      )
    `);

    if (error) {
      return NextResponse.json(
        { error: `Failed to load ticker data: ${error.message}` },
        { status: 500 }
      );
    }

    const tickerStats: Record<
      string,
      {
        ticker: string;
        mentions: number;
        bullishMentions: number;
        bearishMentions: number;
        neutralMentions: number;
        avgConfidenceSum: number;
        sentimentSum: number;
        sentraScore: number;
        rawReach: number;
      }
    > = {};

    let skippedMissingVideo = 0;
    let skippedNullStats = 0;

    for (const row of (data ?? []) as any[]) {
      const ticker = String(row.ticker || "").toUpperCase().trim();
      const video = row.videos as any;

      if (!ticker) continue;

      if (!video) {
        skippedMissingVideo += 1;
        continue;
      }

      if (!hasUsableStats(video, row)) {
        skippedNullStats += 1;
        continue;
      }

      const publishedAt =
        video?.video_published_at ??
        video?.published_at ??
        row.video_published_at ??
        null;

      const { videoSentraScore, stanceValue, confidence, baseReach } =
        computeVideoSentraScore({
          view_count: video?.view_count,
          like_count: video?.like_count,
          comment_count: video?.comment_count,
          video_published_at: publishedAt,
          stance: row.stance,
          confidence: row.confidence,
        });

      if (!tickerStats[ticker]) {
        tickerStats[ticker] = {
          ticker,
          mentions: 0,
          bullishMentions: 0,
          bearishMentions: 0,
          neutralMentions: 0,
          avgConfidenceSum: 0,
          sentimentSum: 0,
          sentraScore: 0,
          rawReach: 0,
        };
      }

      tickerStats[ticker].mentions += 1;
      tickerStats[ticker].avgConfidenceSum += confidence;
      tickerStats[ticker].sentimentSum += stanceValue * confidence;
      tickerStats[ticker].sentraScore += videoSentraScore;
      tickerStats[ticker].rawReach += baseReach;

      if (stanceValue > 0) {
        tickerStats[ticker].bullishMentions += 1;
      } else if (stanceValue < 0) {
        tickerStats[ticker].bearishMentions += 1;
      } else {
        tickerStats[ticker].neutralMentions += 1;
      }
    }

    const sentraMap = new Map(
      Object.values(tickerStats).map((t) => [
        t.ticker,
        {
          mentions: t.mentions,
          bullishMentions: t.bullishMentions,
          bearishMentions: t.bearishMentions,
          neutralMentions: t.neutralMentions,
          avgConfidence: t.mentions > 0 ? t.avgConfidenceSum / t.mentions : null,
          sentiment: t.mentions > 0 ? t.sentimentSum / t.mentions : null,
          sentraScore: t.mentions > 0 ? t.sentraScore : null,
          rawReach: t.mentions > 0 ? t.rawReach : null,
        },
      ])
    );

    const extraTickers = Object.keys(tickerStats)
      .filter(
        (ticker) => !TICKER_UNIVERSE.some((item) => item.ticker === ticker)
      )
      .map((ticker) => ({
        ticker,
        sector: "Other",
      }));

    const universe = [...TICKER_UNIVERSE, ...extraTickers];

    const quoteFields = [
      "shortName",
      "longName",
      "regularMarketPrice",
      "regularMarketChangePercent",
      "regularMarketVolume",
      "marketCap",
    ];

    const tickers = await Promise.all(
      universe.map(async (item) => {
        const sentra = sentraMap.get(item.ticker);

        try {
          const quote: any = await (yahooFinance as any).quoteCombine(
            item.ticker,
            { fields: quoteFields }
          );

          return {
            ticker: item.ticker,
            sector: item.sector,
            companyName:
              quote?.shortName ?? quote?.longName ?? item.ticker,

            price: toNumberOrNull(quote?.regularMarketPrice),
            dayChangePercent: toNumberOrNull(
              quote?.regularMarketChangePercent
            ),
            volume: toNumberOrNull(quote?.regularMarketVolume),
            marketCap: toNumberOrNull(quote?.marketCap),

            mentions: sentra?.mentions ?? null,
            bullishMentions: sentra?.bullishMentions ?? null,
            bearishMentions: sentra?.bearishMentions ?? null,
            neutralMentions: sentra?.neutralMentions ?? null,
            avgConfidence: sentra?.avgConfidence ?? null,
            sentiment: sentra?.sentiment ?? null,
            sentraScore: sentra?.sentraScore ?? null,
            rawReach: sentra?.rawReach ?? null,
          };
        } catch {
          return {
            ticker: item.ticker,
            sector: item.sector,
            companyName: item.ticker,

            price: null,
            dayChangePercent: null,
            volume: null,
            marketCap: null,

            mentions: sentra?.mentions ?? null,
            bullishMentions: sentra?.bullishMentions ?? null,
            bearishMentions: sentra?.bearishMentions ?? null,
            neutralMentions: sentra?.neutralMentions ?? null,
            avgConfidence: sentra?.avgConfidence ?? null,
            sentiment: sentra?.sentiment ?? null,
            sentraScore: sentra?.sentraScore ?? null,
            rawReach: sentra?.rawReach ?? null,
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      version: "sentra-score-v1",
      tickers,
      debug: {
        totalRowsRead: data?.length ?? 0,
        skippedMissingVideo,
        skippedNullStats,
        scoredRows: Object.values(tickerStats).reduce(
          (sum, t) => sum + t.mentions,
          0
        ),
        totalUniverse: universe.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}