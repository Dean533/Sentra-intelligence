import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export async function getMarketProfile(ticker: string) {
  try {
    const symbol = ticker.toUpperCase().trim();

    const result: any = await yahooFinance.quoteSummary(symbol, {
      modules: [
        "assetProfile",
        "price",
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
      ],
    });

    const assetProfile = result?.assetProfile ?? {};
    const price = result?.price ?? {};
    const summaryDetail = result?.summaryDetail ?? {};
    const defaultKeyStatistics = result?.defaultKeyStatistics ?? {};
    const financialData = result?.financialData ?? {};

    return {
      symbol,
      longName: price?.longName ?? price?.shortName ?? symbol,
      shortName: price?.shortName ?? symbol,
      exchange:
        price?.fullExchangeName ?? price?.exchangeName ?? price?.exchange ?? "—",
      website: assetProfile?.website ?? null,
      sector: assetProfile?.sector ?? "—",
      industry: assetProfile?.industry ?? "—",
      description:
        assetProfile?.longBusinessSummary ??
        assetProfile?.companyOfficers?.[0]?.title ??
        "No company description available.",
      marketCap: price?.marketCap ?? summaryDetail?.marketCap ?? null,
      avgVolume:
        summaryDetail?.averageVolume ??
        summaryDetail?.averageDailyVolume3Month ??
        null,
      fiftyTwoWeekHigh:
        summaryDetail?.fiftyTwoWeekHigh ?? financialData?.targetHighPrice ?? null,
      fiftyTwoWeekLow:
        summaryDetail?.fiftyTwoWeekLow ?? financialData?.targetLowPrice ?? null,
      employees: assetProfile?.fullTimeEmployees ?? null,
      eps:
        defaultKeyStatistics?.trailingEps ??
        defaultKeyStatistics?.forwardEps ??
        null,
    };
  } catch {
    return null;
  }
}