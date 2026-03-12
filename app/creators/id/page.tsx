"use client";

import { supabaseServer } from "@/lib/supabase/server";
import Link from "next/link";

export default async function CreatorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = supabaseServer();
  const creatorId = Number(params.id);

  // Creator basic info
  const { data: creator } = await supabase
    .from("creators")
    .select("*")
    .eq("id", creatorId)
    .maybeSingle();

  if (!creator) {
    return <div style={{ padding: 20 }}>Creator not found</div>;
  }

  // All mentions for this creator
  const { data: mentions } = await supabase
    .from("mentions")
    .select("*")
    .eq("creator_id", creatorId);

  const total = mentions?.length ?? 0;

  const positives =
    mentions?.filter((m) => m.sentiment_label === "positive") ?? [];
  const neutrals =
    mentions?.filter((m) => m.sentiment_label === "neutral") ?? [];
  const negatives =
    mentions?.filter((m) => m.sentiment_label === "negative") ?? [];

  const avgSentiment =
    mentions && mentions.length > 0
      ? mentions.reduce((sum, m) => sum + (m.sentiment_score ?? 0), 0) /
        mentions.length
      : 0;

  const topPositive = positives
    .sort((a, b) => (b.sentiment_score ?? 0) - (a.sentiment_score ?? 0))
    .slice(0, 5);

  const topNegative = negatives
    .sort((a, b) => (a.sentiment_score ?? 0) - (b.sentiment_score ?? 0))
    .slice(0, 5);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <Link href="/dashboard">← Back to Dashboard</Link>

      <h1 style={{ marginTop: 16 }}>{creator.name}</h1>

      <p>Total comments: {total}</p>
      <p>Average sentiment: {avgSentiment.toFixed(3)}</p>

      <h2>Sentiment Breakdown</h2>
      <p>Positive: {positives.length}</p>
      <p>Neutral: {neutrals.length}</p>
      <p>Negative: {negatives.length}</p>

      <h2 style={{ marginTop: 24 }}>Top Positive Comments</h2>
      {topPositive.map((m) => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <strong>{m.author_name}</strong>
          <div>{m.context_text}</div>
        </div>
      ))}

      <h2 style={{ marginTop: 24 }}>Top Negative Comments</h2>
      {topNegative.map((m) => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <strong>{m.author_name}</strong>
          <div>{m.context_text}</div>
        </div>
      ))}
    </div>
  );
}
