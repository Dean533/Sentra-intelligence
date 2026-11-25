import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { computeConvictionScore } from '@/lib/scoring/convictionScore'
import { displayRole, formatInsiderName, fmtMoney, fmtStake, fmtDate, toBreakdown, type Breakdown } from '@/lib/insider/format'
import { holdingsDeltaPct, convictionLabel } from '@/lib/insider/holdingsDelta'

// ISR: re-query Supabase at most once an hour.
export const revalidate = 3600

// ─── Data ────────────────────────────────────────────────────────────────────

type TxRow = {
  id: string | number
  ticker: string
  insider_name: string | null
  role: string | null
  officer_title: string | null
  total_value: number | null
  price_per_share: number | null
  shares: number | null
  shares_owned_after: number | null
  transaction_date: string
  transaction_code: string | null
  filed_date: string | null
  conviction_score: number | null
  classification: 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null
}


type TopBuy = {
  id: string | number
  ticker: string
  company: string | null
  insider: string
  role: string
  value: number | null
  stake: { pct: number; capped: boolean } | null
  score: number
  filed: string
  breakdown: Breakdown[]
}

type Window = { days: 7 | 30 | 90; heading: string; eyebrow: string; cta: string }

const WINDOWS: Window[] = [
  { days: 7,  heading: "This week's top 10 insider buys",     eyebrow: 'TOP SIGNAL THIS WEEK',       cta: "See this week's buys" },
  { days: 30, heading: "Last 30 days' top 10 insider buys",   eyebrow: 'TOP SIGNAL, LAST 30 DAYS',   cta: 'See the top buys' },
  { days: 90, heading: "Last 90 days' top 10 insider buys",   eyebrow: 'TOP SIGNAL, LAST 90 DAYS',   cta: 'See the top buys' },
]

const SELECT_COLS =
  'id, ticker, insider_name, role, officer_title, total_value, price_per_share, shares, ' +
  'shares_owned_after, transaction_date, transaction_code, filed_date, conviction_score, classification'

// Fetch enough rows that deduping (one row per insider per ticker) still leaves 10.
const FETCH_LIMIT = 60

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

// One row per insider per ticker (multiple Form 4 lots for the same buy otherwise
// crowd the list); rows arrive sorted by score, so the first seen is the best.
function dedupe(rows: TxRow[]): TxRow[] {
  const seen = new Set<string>()
  const out: TxRow[] = []
  for (const r of rows) {
    const key = `${r.ticker}|${(r.insider_name ?? '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

async function getTopBuys(): Promise<{ window: Window; rows: TopBuy[] }> {
  // Same server-side client/key convention as the /api/insider/* routes.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  let picked: TxRow[] = []
  let window = WINDOWS[WINDOWS.length - 1]

  for (const w of WINDOWS) {
    const { data, error } = await sb
      .from('insider_transactions')
      .select(SELECT_COLS)
      .eq('transaction_code', 'P')
      .eq('classification', 'OPPORTUNISTIC')
      .gte('filed_date', isoDaysAgo(w.days))
      .not('conviction_score', 'is', null)
      .order('conviction_score', { ascending: false })
      .order('total_value', { ascending: false, nullsFirst: false })
      .limit(FETCH_LIMIT)
    if (error) {
      console.error('[home] top buys query failed:', error.message)
      continue
    }
    const rows = dedupe((data ?? []) as unknown as TxRow[])
    picked = rows
    window = w
    if (rows.length >= 10) break
  }

  const top = picked.slice(0, 10)
  if (top.length === 0) return { window, rows: [] }

  const symbols = [...new Set(top.map((r) => r.ticker))]
  const { data: tickers, error: tErr } = await sb
    .from('tickers')
    .select('symbol, name, market_cap')
    .in('symbol', symbols)
  if (tErr) console.error('[home] tickers join failed:', tErr.message)
  const meta = new Map((tickers ?? []).map((t) => [t.symbol as string, t as { name: string | null; market_cap: number | null }]))

  const rows: TopBuy[] = top.map((r) => {
    const m = meta.get(r.ticker)
    const result = computeConvictionScore(
      {
        ticker: r.ticker,
        insider_name: r.insider_name ?? '',
        officer_title: r.officer_title,
        role: r.role,
        total_value: r.total_value,
        price_per_share: r.price_per_share,
        transaction_date: r.transaction_date,
        is_opportunistic: true,
        is_local: null,
        sector: null,
        cluster_count: 0,
        cluster_total_value: 0,
        insider_median_value: null,
        classification: r.classification,
        shares: r.shares,
        shares_owned_after: r.shares_owned_after,
        market_cap: m?.market_cap ?? null,
      },
      [],
      [],
    )

    if (process.env.NODE_ENV !== 'production' && result.score !== r.conviction_score) {
      console.warn(`[home] score mismatch ${r.ticker}/${r.insider_name}: stored ${r.conviction_score}, recomputed ${result.score}`)
    }

    const role = displayRole(r)
    return {
      id: r.id,
      ticker: r.ticker,
      company: m?.name ?? null,
      insider: formatInsiderName(r.insider_name),
      role,
      value: r.total_value,
      stake: holdingsDeltaPct(r),
      score: r.conviction_score ?? result.score,
      filed: r.filed_date ?? r.transaction_date,
      breakdown: toBreakdown(result.breakdown, role),
    }
  })

  return { window, rows }
}

// ─── Small UI pieces ─────────────────────────────────────────────────────────

const btnPrimary =
  'inline-flex h-11 items-center rounded-sm bg-text px-5 text-sm font-semibold text-background no-underline transition-colors hover:bg-white hover:text-background'
const btnSecondary =
  'inline-flex h-11 items-center rounded-sm border border-border-strong px-5 text-sm font-medium text-text no-underline transition-colors hover:border-muted hover:text-white'
const textLink = 'text-sm text-text-secondary underline underline-offset-2 hover:text-white'
const h2Cls = 'm-0 font-serif text-[28px] font-normal leading-tight text-heading md:text-[34px]'

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
}

function Bar({ pct, width }: { pct: number; width?: number }) {
  return (
    <div className="h-1 rounded-[2px] bg-track" style={width ? { width } : undefined}>
      <div className="h-1 rounded-[2px] bg-text-secondary" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-mono">{label}</span>
      <span className="font-mono text-sm text-heading">{value}</span>
    </div>
  )
}

function SignalCard({ row, eyebrow }: { row: TopBuy; eyebrow: string }) {
  return (
    <div className="flex min-w-0 flex-[1_1_430px] flex-col gap-5 rounded-md border border-border bg-surface p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-[1_0_auto]">
          <div className="label-mono sm:whitespace-nowrap">{eyebrow}</div>
          <Link href={`/t/${row.ticker}`} className="font-mono text-2xl font-semibold text-heading no-underline hover:text-white">
            {row.ticker}
          </Link>
          <div className="text-sm text-text-secondary sm:whitespace-nowrap">
            {row.insider}, {row.role}
          </div>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-2">
          <div className="font-mono text-[52px] font-medium leading-none text-opportunistic">{row.score}</div>
          <span className="inline-flex items-center gap-1.5 text-right text-xs text-opportunistic sm:whitespace-nowrap">
            <Dot color="var(--color-opportunistic)" />
            Opportunistic · {convictionLabel('OPPORTUNISTIC', row.score)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-7 border-y border-border py-3.5">
        <Stat label="BOUGHT" value={fmtMoney(row.value)} />
        <Stat label="STAKE Δ" value={fmtStake(row.stake)} />
        <Stat label="FILED" value={fmtDate(row.filed)} />
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap justify-between gap-3">
          <div className="label-mono">WHY IT SCORED {row.score}</div>
          <div className="text-xs text-muted">Beats {row.score}% of opportunistic buys</div>
        </div>
        {row.breakdown.map((b) => (
          <div key={b.label} className="flex flex-col gap-1.5">
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="text-text-secondary">{b.label}</span>
              <span className="font-mono text-muted">{b.pts}</span>
            </div>
            <Bar pct={b.pct} />
          </div>
        ))}
      </div>
    </div>
  )
}

const th = 'px-4 py-3 font-mono text-[11px] font-medium tracking-[0.08em] text-muted'
const td = 'px-4 py-[13px]'

function TopTable({ rows }: { rows: TopBuy[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left">
            <th className={`${th} w-10`}>#</th>
            <th className={th}>TICKER</th>
            <th className={th}>INSIDER</th>
            <th className={`${th} text-right`}>BOUGHT</th>
            <th className={`${th} text-right`}>STAKE Δ</th>
            <th className={th}>SCORE</th>
            <th className={`${th} text-right`}>FILED</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-row-border last:border-b-0 hover:bg-surface-hover">
              <td className={`${td} font-mono text-muted`}>{i + 1}</td>
              <td className={`${td} max-w-[300px] truncate`}>
                <Link href={`/t/${r.ticker}`} className="font-mono font-semibold text-heading no-underline hover:text-white hover:underline">
                  {r.ticker}
                </Link>
                {r.company && <span className="pl-2.5 text-muted">{r.company}</span>}
              </td>
              <td className={`${td} text-text-secondary`}>
                {r.insider}
                <span className="text-muted"> · {r.role}</span>
              </td>
              <td className={`${td} text-right font-mono text-text`}>{fmtMoney(r.value)}</td>
              <td className={`${td} text-right font-mono text-text-secondary`}>{fmtStake(r.stake)}</td>
              <td className={td}>
                <div className="flex items-center gap-2.5">
                  <span className="w-[22px] font-mono font-semibold text-heading">{r.score}</span>
                  <Bar pct={r.score} width={72} />
                </div>
              </td>
              <td className={`${td} text-right font-mono text-muted`}>{fmtDate(r.filed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Static content ──────────────────────────────────────────────────────────

const PAPERS = [
  {
    venue: 'JOURNAL OF FINANCE · 2012',
    title: 'Decoding Inside Information',
    authors: 'Cohen, Malloy & Pomorski',
    finding:
      'Insiders who trade outside their usual calendar pattern earn significant abnormal returns. Those on predictable schedules earn essentially none.',
    use: 'the core classification. Every insider is judged against their own history.',
  },
  {
    venue: 'REVIEW OF ECONOMICS & STATISTICS · 2003',
    title: 'Estimating the Returns to Insider Trading',
    authors: 'Jeng, Metrick & Zeckhauser',
    finding:
      'Insider purchases earn roughly 6% abnormal return over six months. Insider sales show no significant predictive power.',
    use: 'only purchases are scored. Sales are too noisy to mean much.',
  },
]

// Source: output/backtest-results.json, bucket cls_dir:OPPORTUNISTIC:buy
// (scripts/backtest-universe.ts; alpha = stock return − SPY return, 180 trading-day horizon).
const EVIDENCE = [
  { value: '+7.07%', label: 'Mean excess return vs. SPY, 6 months' },
  { value: '4,699', label: 'Opportunistic buys tested' },
  { value: '2021–2026', label: 'Test period' },
]

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const { window, rows } = await getTopBuys()
  const top = rows[0]

  return (
    <div className="bg-background pt-16 text-text">
      <main className="mx-auto max-w-[1400px] px-4 md:px-8">
        {/* HERO */}
        <section className="flex flex-wrap items-center gap-10 pb-14 pt-12 md:gap-16 md:pt-20">
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
            <div className="font-mono text-[11px] tracking-[0.08em] text-muted md:text-xs">
              SEC FORM 4 · RUSSELL 3000 · UPDATED EACH TRADING DAY
            </div>
            <h1 className="m-0 font-serif text-[42px] font-normal leading-[1.04] tracking-[-0.015em] text-heading md:text-[62px]">
              The insider buys
              <br />
              that actually matter.
            </h1>
            <p className="m-0 max-w-[560px] text-base leading-relaxed text-text-secondary md:text-[17px]">
              Most insider trades are routine: scheduled sales, grants, habit. Sentra reads every filing across the Russell 3000, filters out the
              routine, and ranks the buys where an insider broke their own pattern.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#top10" className={btnPrimary}>
                {window.cta}
              </a>
              <Link href="/about" className={btnSecondary}>
                How it works
              </Link>
            </div>
          </div>

          {top && <SignalCard row={top} eyebrow={window.eyebrow} />}
        </section>

        {/* TOP 10 */}
        <section id="top10" className="flex scroll-mt-20 flex-col gap-5 border-t border-border pb-6 pt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h2 className={h2Cls}>{window.heading}</h2>
              <div className="text-sm text-muted">Opportunistic purchases only, ranked by conviction score.</div>
            </div>
            <Link href="/events?classification=OPPORTUNISTIC" className={textLink}>
              Open full screener
            </Link>
          </div>
          {rows.length > 0 ? (
            <TopTable rows={rows} />
          ) : (
            <div className="rounded-md border border-border px-6 py-10 text-center text-sm text-muted">
              No opportunistic buys filed in the last 90 days. Check back after the next trading day.
            </div>
          )}
        </section>

        {/* HOW TO READ */}
        <section className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-12 border-b border-border py-12">
          <div className="flex flex-col gap-3">
            <div className="label-mono">STEP 1 · CLASSIFICATION</div>
            <div className="font-serif text-[26px] leading-snug text-heading">Is this insider trading out of habit?</div>
            <p className="m-0 text-[15px] leading-relaxed text-text-secondary">
              Insiders who trade in the same month every year are routine. When one breaks that pattern, the trade is opportunistic. Based on
              Cohen, Malloy &amp; Pomorski (2012).
            </p>
            <div className="flex flex-wrap gap-[18px] pt-1 text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-opportunistic"><Dot color="var(--color-opportunistic)" />Opportunistic</span>
              <span className="inline-flex items-center gap-1.5 text-unclassifiable"><Dot color="var(--color-unclassifiable)" />Unclassifiable</span>
              <span className="inline-flex items-center gap-1.5 text-routine"><Dot color="var(--color-routine)" />Routine</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="label-mono">STEP 2 · SCORE</div>
            <div className="font-serif text-[26px] leading-snug text-heading">How much conviction is behind the buy?</div>
            <p className="m-0 text-[15px] leading-relaxed text-text-secondary">
              Every open-market purchase gets a 0 to 100 percentile rank within its class, built from four walk-forward validated factors: stake
              increase, price momentum, insider role, and company size. Sales aren&apos;t scored.
            </p>
            <div className="pt-1">
              <Link href="/about" className={textLink}>
                Read the methodology
              </Link>
            </div>
          </div>
        </section>

        {/* ACADEMIC FOUNDATION */}
        <section className="flex flex-col gap-6 border-b border-border py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="label-mono">ACADEMIC FOUNDATION</div>
              <h2 className={h2Cls}>Built on published research</h2>
            </div>
            <Link href="/about" className={textLink}>
              Full methodology
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
            {PAPERS.map((p) => (
              <article key={p.title} className="flex flex-col gap-3 rounded-md border border-border p-6">
                <div className="label-mono">{p.venue}</div>
                <div className="font-serif text-[22px] leading-snug text-heading">{p.title}</div>
                <div className="text-[13px] text-muted">{p.authors}</div>
                <p className="m-0 text-[15px] leading-relaxed text-text-secondary">{p.finding}</p>
                <p className="m-0 border-t border-border pt-3 text-sm leading-normal text-muted">
                  <span className="text-text-secondary">How Sentra uses it:</span> {p.use}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* EVIDENCE */}
        <section className="flex flex-col gap-6 border-b border-border py-14">
          <div className="flex flex-col gap-2">
            <div className="label-mono">EVIDENCE</div>
            <h2 className={h2Cls}>Does it work?</h2>
            <p className="m-0 max-w-[640px] text-sm leading-relaxed text-muted">
              Backtest of opportunistic buys against SPY. Shown with its limits.
            </p>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-md border border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {EVIDENCE.map((e) => (
              <div key={e.label} className="flex flex-col gap-1.5 px-5 py-5 md:px-6 md:py-[22px]">
                <div className="font-mono text-[22px] font-medium text-heading md:text-[28px]">{e.value}</div>
                <div className="text-[13px] text-muted">{e.label}</div>
              </div>
            ))}
          </div>
          <p className="m-0 max-w-[760px] text-sm leading-relaxed text-muted">
            Caveats: a minority of large winners drive the average; the median trade trailed SPY by 2.58%. No trading costs or slippage
            modeled.{' '}
            <Link href="/about" className={textLink}>
              Full backtest
            </Link>
          </p>
        </section>

        {/* BUILT BY */}
        <section className="flex flex-wrap items-center justify-between gap-8 pb-16 pt-12">
          <div className="flex max-w-[640px] flex-col gap-2">
            <div className="label-mono">BUILT BY</div>
            <div className="font-serif text-[28px] text-heading">Dean Gans</div>
            <p className="m-0 text-[15px] leading-relaxed text-text-secondary">
              Finance and Applied Math student. I built Sentra solo to test whether academic insider research holds up on live filings. Happy to
              talk about how it works.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <a
              href="https://www.linkedin.com/in/deangans"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-sm border border-border-strong px-[18px] text-sm text-text no-underline hover:border-muted hover:text-white"
            >
              LinkedIn
            </a>
            <a
              href="mailto:deangans815@gmail.com"
              className="inline-flex h-11 items-center rounded-sm bg-text px-[18px] text-sm font-semibold text-background no-underline hover:bg-white hover:text-background"
            >
              Email me
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}
