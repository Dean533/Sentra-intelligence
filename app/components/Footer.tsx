import Link from 'next/link'

const linkCls = 'text-sm text-text-secondary no-underline transition-colors hover:text-white'

export default function Footer() {
  return (
    <footer className="border-t border-border bg-footer">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 pb-8 pt-14 md:px-8">
        <div className="flex flex-wrap justify-between gap-12">
          <div className="flex max-w-[380px] flex-col gap-3.5">
            <Link href="/" className="font-mono text-[15px] font-semibold tracking-[0.12em] text-text no-underline hover:text-white">
              SENTRA<span className="font-normal text-muted">/SIGNALS</span>
            </Link>
            <p className="m-0 text-sm leading-relaxed text-muted">
              Sentra Signals is an insider-activity radar. It tracks SEC Form 4 filings across the Russell 3000 and surfaces the trades that carry real signal.
            </p>
          </div>

          <div className="flex flex-wrap gap-12 sm:gap-24">
            <div className="flex flex-col gap-3">
              <div className="label-mono">COMMUNITY</div>
              <a href="https://x.com/deangans_" target="_blank" rel="noopener noreferrer" className={linkCls}>X / Twitter</a>
              <a href="https://www.linkedin.com/company/sentrasignals/" target="_blank" rel="noopener noreferrer" className={linkCls}>LinkedIn</a>
            </div>
            <div className="flex flex-col gap-3">
              <div className="label-mono">LEGAL</div>
              <Link href="/privacy" className={linkCls}>Privacy Policy</Link>
              <Link href="/terms" className={linkCls}>Terms of Service</Link>
              <a href="/sitemap.xml" className={linkCls}>Sitemap</a>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-5 text-xs leading-relaxed text-muted">
          <span>Sentra Signals 2026</span>
          <span className="max-w-[820px]">
            Sentra Signals provides informational data only and is not a registered investment advisor. Nothing on this site is investment advice. Insider trading data is sourced from public SEC filings. Do your own research before making any investment decision.
          </span>
        </div>
      </div>
    </footer>
  )
}
