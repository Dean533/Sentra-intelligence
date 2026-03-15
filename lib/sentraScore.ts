export function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parsePublishedAt(value: unknown): number | null {
  if (!value || typeof value !== "string") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function stanceToValue(stance: unknown): number {
  if (stance === "bullish") return 1;
  if (stance === "bearish") return -1;
  return 0;
}

export function computeVideoSentraScore(input: {
  view_count: unknown;
  like_count: unknown;
  comment_count: unknown;
  video_published_at: unknown;
  stance: unknown;
  confidence: unknown;
}) {
  const V = safeNumber(input.view_count);
  const L = safeNumber(input.like_count);
  const C = safeNumber(input.comment_count);

  const baseReach = V + 8 * L + 20 * C;

  const likeRate = L / Math.max(V, 1);
  const commentRate = C / Math.max(V, 1);
  const engagementMultiplier = 1 + 4 * likeRate + 10 * commentRate;

  const publishedMs = parsePublishedAt(input.video_published_at);
  const now = Date.now();

  let recencyWeight = 1;
  if (publishedMs !== null) {
    const ageHours = Math.max(0, (now - publishedMs) / (1000 * 60 * 60));
    recencyWeight = Math.exp(-ageHours / 72);
  }

  const stanceValue = stanceToValue(input.stance);
  const confidence = safeNumber(input.confidence) || 0.5;
  const toneMultiplier = 1 + 0.15 * (stanceValue * confidence);

  const videoSentraScore =
    baseReach * engagementMultiplier * recencyWeight * toneMultiplier;

  return {
    videoSentraScore,
    stanceValue,
    confidence,
    baseReach,
    likeRate,
    commentRate,
    engagementMultiplier,
    recencyWeight,
    toneMultiplier,
  };
}