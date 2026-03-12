import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const supabase = supabaseServer();

  const { data: positionRows, error: positionsError } = await supabase
    .from("video_positions")
    .select("ticker, video_id");

  if (positionsError) {
    return NextResponse.json(
      { error: positionsError.message },
      { status: 500 }
    );
  }

  const videoIds = Array.from(
    new Set((positionRows ?? []).map((row) => row.video_id).filter(Boolean))
  );

  const { data: videoRows, error: videosError } = await supabase
    .from("videos")
    .select("id, title, view_count")
    .in("id", videoIds);

  if (videosError) {
    return NextResponse.json(
      { error: videosError.message },
      { status: 500 }
    );
  }

  const videoMap = new Map<number, { title: string | null; view_count: number }>();
  (videoRows ?? []).forEach((row) => {
    videoMap.set(row.id, {
      title: row.title ?? null,
      view_count: row.view_count ?? 0,
    });
  });

  const tickerToVideoIds = new Map<string, Set<number>>();

  (positionRows ?? []).forEach((row) => {
    const ticker = row.ticker?.trim().toUpperCase();
    const videoId = row.video_id;

    if (!ticker || !videoId) return;

    if (!tickerToVideoIds.has(ticker)) {
      tickerToVideoIds.set(ticker, new Set<number>());
    }

    tickerToVideoIds.get(ticker)!.add(videoId);
  });

  const results = Array.from(tickerToVideoIds.entries())
    .map(([ticker, uniqueVideoIds]) => {
      let attention = 0;

      uniqueVideoIds.forEach((videoId) => {
        attention += videoMap.get(videoId)?.view_count ?? 0;
      });

      return {
        ticker,
        mentions: uniqueVideoIds.size,
        sentiment: 0,
        velocity: 0,
        attention,
      };
    })
    .sort((a, b) => b.attention - a.attention);

  const tslaVideoBreakdown = Array.from(tickerToVideoIds.get("TSLA") ?? [])
    .map((videoId) => ({
      video_id: videoId,
      title: videoMap.get(videoId)?.title ?? null,
      view_count: videoMap.get(videoId)?.view_count ?? 0,
    }))
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 20);

  return NextResponse.json({
    success: true,
    version: "unique-video-attention-v3-debug",
    tickers: results,
    debug: {
      tslaVideoBreakdown,
    },
  });
}