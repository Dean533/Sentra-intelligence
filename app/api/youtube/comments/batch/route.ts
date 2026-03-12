// app/api/youtube/comments/batch/route.ts

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const limit = Number(searchParams.get("limit") || "10");
    const maxResults = Number(searchParams.get("maxResults") || "50");

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: "Missing YOUTUBE_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const supabase = supabaseServer();

    // Load recent videos
    const { data: videos, error: videosErr } = await supabase
      .from("videos")
      .select("id, youtube_video_id, creator_id")
      .or("processed_status.is.null,processed_status.eq.new")
      .order("id", { ascending: false })
      .limit(limit);

    if (videosErr) {
      return NextResponse.json(
        { error: "Failed to load videos", details: videosErr.message },
        { status: 500 }
      );
    }

    if (!videos || videos.length === 0) {
      return NextResponse.json({ success: true, message: "No videos found" });
    }

    let videosAttempted = 0;
    let videosSucceeded = 0;
    let mentionsUpsertedTotal = 0;

    const errors: Array<{ youtube_video_id: string; error: string }> = [];

    for (const v of videos) {
      const youtubeVideoId = v.youtube_video_id;
      if (!youtubeVideoId) continue;

      videosAttempted += 1;

      try {
        const upserted = await ingestCommentsForVideo({
          supabase,
          videoId: v.id,
          creatorId: v.creator_id,
          youtubeVideoId,
          maxResults,
          apiKey: process.env.YOUTUBE_API_KEY,
        });

        videosSucceeded += 1;
        mentionsUpsertedTotal += upserted;

        await supabase
          .from("videos")
          .update({
            processed_status: "done",
            fetched_at: new Date().toISOString(),
          })
          .eq("id", v.id);
      } catch (e: any) {
        errors.push({
          youtube_video_id: youtubeVideoId,
          error: e?.message || "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      limit,
      maxResults,
      videosAttempted,
      videosSucceeded,
      mentionsUpsertedTotal,
      errors,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Batch comments ingest failed", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}

async function ingestCommentsForVideo(params: {
  supabase: ReturnType<typeof supabaseServer>;
  videoId: number;
  creatorId: number | null;
  youtubeVideoId: string;
  maxResults: number;
  apiKey: string;
}) {
  const { supabase, videoId, creatorId, youtubeVideoId, maxResults, apiKey } =
    params;

  if (!creatorId) {
    return 0;
  }

  const { data: positions, error: posErr } = await supabase
    .from("video_positions")
    .select("ticker")
    .eq("video_id", videoId);

  if (posErr) {
    throw new Error(`Failed to load video_positions: ${posErr.message}`);
  }

  const tickers = (positions || []).map((p: any) => p.ticker).filter(Boolean);

  if (tickers.length === 0) return 0;

  const url =
    "https://www.googleapis.com/youtube/v3/commentThreads" +
    `?part=snippet&videoId=${encodeURIComponent(youtubeVideoId)}` +
    `&maxResults=${maxResults}` +
    `&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const items = Array.isArray(json.items) ? json.items : [];

  const rows: any[] = [];

  for (const it of items) {
    const c = it?.snippet?.topLevelComment;
    const snip = c?.snippet;

    const youtube_comment_id = c?.id;
    if (!youtube_comment_id) continue;

    const context_text = snip?.textDisplay ?? "";
    const author_name = snip?.authorDisplayName ?? null;
    const youtube_published_at = snip?.publishedAt ?? null;

    const sentiment_score = scoreSentiment(context_text);
    const sentiment_label =
      sentiment_score > 0
        ? "positive"
        : sentiment_score < 0
        ? "negative"
        : "neutral";

    for (const ticker of tickers) {
      rows.push({
        video_id: videoId,
        creator_id: creatorId,
        ticker,
        source: "youtube_comment",
        context_text,
        youtube_comment_id,
        author_name,
        sentiment_score,
        sentiment_label,
        youtube_published_at,
      });
    }
  }

  if (rows.length === 0) return 0;

  const seen = new Set<string>();
  const deduped: any[] = [];

  for (const r of rows) {
    const key = `${r.youtube_comment_id}::${r.ticker}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const { error: upsertErr } = await supabase
    .from("mentions")
    .upsert(deduped, { onConflict: "youtube_comment_id,ticker" });

  if (upsertErr) {
    throw new Error(`Supabase upsert error: ${upsertErr.message}`);
  }

  return deduped.length;
}

function scoreSentiment(text: string): number {
  if (!text) return 0;

  const positiveWords = [
    "good",
    "great",
    "bullish",
    "buy",
    "moon",
    "pump",
    "strong",
    "love",
    "amazing",
    "profit",
  ];

  const negativeWords = [
    "bad",
    "terrible",
    "bearish",
    "sell",
    "crash",
    "dump",
    "weak",
    "hate",
    "scam",
    "loss",
  ];

  let score = 0;
  const lower = text.toLowerCase();

  for (const word of positiveWords) {
    if (lower.includes(word)) score += 1;
  }

  for (const word of negativeWords) {
    if (lower.includes(word)) score -= 1;
  }

  if (score > 5) score = 5;
  if (score < -5) score = -5;

  return score;
}