const TRADING_URL = (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
const DATA_URL    = 'https://data.alpaca.markets'

function headers(): Record<string, string> {
  return {
    'APCA-API-KEY-ID':     process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
    'Content-Type':        'application/json',
  }
}

async function alpacaFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: headers() })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Alpaca ${init?.method ?? 'GET'} ${url} → ${res.status}: ${body}`)
  }
  return res.json()
}

// Places a day-limit bracket order (stop loss + take profit attached).
// Uses last known price as limit_price so the order queues at market open
// rather than being rejected outside regular trading hours.
// extended_hours: false ensures it only executes during regular session.
export async function placeOrder(
  symbol:          string,
  qty:             number,
  side:            'buy' | 'sell',
  limitPrice:      number,
  stopLossPrice:   number,
  takeProfitPrice: number,
) {
  return alpacaFetch(`${TRADING_URL}/v2/orders`, {
    method: 'POST',
    body: JSON.stringify({
      symbol,
      qty:             String(qty),
      side,
      type:            'limit',
      limit_price:     limitPrice.toFixed(2),
      time_in_force:   'day',
      extended_hours:  false,
      order_class:     'bracket',
      stop_loss:       { stop_price:  stopLossPrice.toFixed(2),   time_in_force: 'gtc' },
      take_profit:     { limit_price: takeProfitPrice.toFixed(2), time_in_force: 'gtc' },
    }),
  })
}

// Returns all open positions on the account.
export async function getPositions(): Promise<{ symbol: string; qty: string; market_value: string }[]> {
  return alpacaFetch(`${TRADING_URL}/v2/positions`)
}

// Returns account cash balance and buying power.
export async function getAccount(): Promise<{ cash: string; buying_power: string; portfolio_value: string }> {
  return alpacaFetch(`${TRADING_URL}/v2/account`)
}

// Returns the latest trade price for each symbol in the array.
// Uses the IEX feed (free, no subscription required for paper accounts).
export async function getLatestPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {}
  const qs  = symbols.map(s => encodeURIComponent(s)).join(',')
  const res = await alpacaFetch(`${DATA_URL}/v2/stocks/trades/latest?symbols=${qs}&feed=iex`)
  const out: Record<string, number> = {}
  for (const [sym, trade] of Object.entries(res.trades ?? {})) {
    out[sym] = (trade as any).p as number
  }
  return out
}
