import { NextResponse } from "next/server";
import { getMarketHistory, type MarketRange } from "@/lib/marketData";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = (searchParams.get("ticker") || "").trim();
    const range = (searchParams.get("range") || "1mo") as MarketRange;

    if (!ticker) {
      return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
    }

    const data = await getMarketHistory(ticker, range);

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to load market history" },
      { status: 500 }
    );
  }
}