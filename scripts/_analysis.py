import csv, statistics
from collections import defaultdict

rows = []
with open("output/opportunistic_trades_enriched.csv") as f:
    reader = csv.DictReader(f)
    for r in reader:
        rows.append(r)

def safe_float(v):
    try:
        return float(v)
    except:
        return None

def fmt(x):
    return f"{x:.1f}" if x is not None else "N/A"

for r in rows:
    r['_val']   = safe_float(r['total_value'])
    r['_r30']   = safe_float(r['return_30d'])
    r['_r90']   = safe_float(r['return_90d'])
    r['_r180']  = safe_float(r['return_180d'])
    r['_adj90'] = safe_float(r['adjusted_return_90d'])
    r['_spy90'] = safe_float(r['spy_return_90d'])
    r['_sc90']  = r['signal_correct_90d'].strip().lower() == 'true'

def stats(subset):
    r90  = [r['_r90']   for r in subset if r['_r90']   is not None]
    adj  = [r['_adj90'] for r in subset if r['_adj90'] is not None]
    sc   = [r for r in subset if r['signal_correct_90d'].strip().lower() in ('true','false')]
    hit  = sum(1 for r in sc if r['_sc90']) / len(sc) if sc else None
    return {
        'n':        len(subset),
        'mean90':   statistics.mean(r90) if r90 else None,
        'med90':    statistics.median(r90) if r90 else None,
        'meanadj':  statistics.mean(adj) if adj else None,
        'medadj':   statistics.median(adj) if adj else None,
        'hit':      hit,
        'n_hit':    len(sc),
    }

def ps(s, label):
    hit = f"{s['hit']*100:.0f}%" if s['hit'] is not None else " N/A"
    print(f"  {label:<38} n={s['n']:>4}  hit={hit:>4}  "
          f"90d_mean={fmt(s['mean90']):>6}  90d_med={fmt(s['med90']):>6}  "
          f"alpha_mean={fmt(s['meanadj']):>6}  alpha_med={fmt(s['medadj']):>6}")

def classify_role(r):
    role  = r['role'].strip().lower()
    title = r['officer_title'].strip().lower()
    if 'ceo' in role or 'chief executive' in role or 'ceo' in title or 'chief executive' in title:
        return 'CEO'
    if 'cfo' in role or 'chief financial' in role or 'cfo' in title:
        return 'CFO'
    if 'president' in role or 'president' in title:
        return 'President'
    if 'director' in role:
        return 'Director'
    if '10%' in role or '10% owner' in role:
        return '10% Owner'
    if 'co-founder' in role:
        return 'Co-Founder/Partner'
    if 'insider' in role:
        return 'Insider (other)'
    return 'Other/EVP'

SEP = "=" * 96

# ─── OVERALL ────────────────────────────────────────────────────────────────
print(SEP)
print("OVERALL BASELINE")
print(SEP)
ps(stats(rows), "All trades")

# ─── BY DOLLAR SIZE ─────────────────────────────────────────────────────────
print("\n" + SEP)
print("BY DOLLAR SIZE")
print(SEP)

size_buckets = [
    ("< $100K",      lambda v: v is not None and v < 100_000),
    ("$100K–250K",   lambda v: v is not None and 100_000 <= v < 250_000),
    ("$250K–500K",   lambda v: v is not None and 250_000 <= v < 500_000),
    ("$500K–1M",     lambda v: v is not None and 500_000 <= v < 1_000_000),
    ("$1M–5M",       lambda v: v is not None and 1_000_000 <= v < 5_000_000),
    ("$5M–25M",      lambda v: v is not None and 5_000_000 <= v < 25_000_000),
    ("$25M+",        lambda v: v is not None and v >= 25_000_000),
]
for label, fn in size_buckets:
    sub = [r for r in rows if fn(r['_val'])]
    ps(stats(sub), label)

# ─── BY ROLE ────────────────────────────────────────────────────────────────
print("\n" + SEP)
print("BY ROLE")
print(SEP)

role_groups = defaultdict(list)
for r in rows:
    role_groups[classify_role(r)].append(r)
for rk in sorted(role_groups.keys()):
    ps(stats(role_groups[rk]), rk)

# ─── BY TICKER ──────────────────────────────────────────────────────────────
print("\n" + SEP)
print("BY TICKER (>=5 trades, sorted by median alpha)")
print(SEP)

ticker_groups = defaultdict(list)
for r in rows:
    ticker_groups[r['ticker']].append(r)

tresults = sorted(
    [(t, stats(sub)) for t, sub in ticker_groups.items() if len(sub) >= 5],
    key=lambda x: (x[1]['medadj'] or -99), reverse=True
)
for t, s in tresults:
    ps(s, t)

# ─── BY INSIDER ─────────────────────────────────────────────────────────────
print("\n" + SEP)
print("BY INSIDER (>=5 trades, sorted by median alpha)")
print(SEP)

insider_groups = defaultdict(list)
for r in rows:
    insider_groups[r['insider_name']].append(r)

iresults = sorted(
    [(n, stats(sub)) for n, sub in insider_groups.items() if len(sub) >= 5],
    key=lambda x: (x[1]['medadj'] or -99), reverse=True
)
for name, s in iresults:
    ps(s, name[:38])

# ─── BY MARKET CONDITIONS ───────────────────────────────────────────────────
print("\n" + SEP)
print("BY MARKET CONDITIONS (SPY 90d return realized after trade)")
print(SEP)

mkt_buckets = [
    ("SPY very weak (< -5%)",    lambda r: r['_spy90'] is not None and r['_spy90'] < -5),
    ("SPY weak (-5% to 0%)",     lambda r: r['_spy90'] is not None and -5 <= r['_spy90'] < 0),
    ("SPY flat (0-5%)",          lambda r: r['_spy90'] is not None and  0 <= r['_spy90'] < 5),
    ("SPY good (5-10%)",         lambda r: r['_spy90'] is not None and  5 <= r['_spy90'] < 10),
    ("SPY strong (10-15%)",      lambda r: r['_spy90'] is not None and 10 <= r['_spy90'] < 15),
    ("SPY very strong (15%+)",   lambda r: r['_spy90'] is not None and r['_spy90'] >= 15),
]
for label, fn in mkt_buckets:
    sub = [r for r in rows if fn(r)]
    ps(stats(sub), label)

# ─── COMBINED FILTERS ───────────────────────────────────────────────────────
print("\n" + SEP)
print("COMBINED FILTERS")
print(SEP)

combos = [
    ("All",                        rows),
    (">= $250K",                   [r for r in rows if r['_val'] and r['_val'] >= 250_000]),
    (">= $500K",                   [r for r in rows if r['_val'] and r['_val'] >= 500_000]),
    (">= $1M",                     [r for r in rows if r['_val'] and r['_val'] >= 1_000_000]),
    ("CEO/President",              [r for r in rows if classify_role(r) in ('CEO','President')]),
    ("Director",                   [r for r in rows if classify_role(r) == 'Director']),
    (">=$250K + CEO/President",    [r for r in rows if r['_val'] and r['_val'] >= 250_000 and classify_role(r) in ('CEO','President')]),
    (">=$250K + Director",         [r for r in rows if r['_val'] and r['_val'] >= 250_000 and classify_role(r) == 'Director']),
    (">=$500K + CEO/President",    [r for r in rows if r['_val'] and r['_val'] >= 500_000 and classify_role(r) in ('CEO','President')]),
    (">=$1M + CEO/President",      [r for r in rows if r['_val'] and r['_val'] >= 1_000_000 and classify_role(r) in ('CEO','President')]),
    ("SPY<5% (muted mkt)",         [r for r in rows if r['_spy90'] is not None and r['_spy90'] < 5]),
    (">=$250K + Dir + SPY<5%",     [r for r in rows if r['_val'] and r['_val'] >= 250_000 and classify_role(r) == 'Director' and r['_spy90'] is not None and r['_spy90'] < 5]),
    (">=$250K + CEO + SPY<10%",    [r for r in rows if r['_val'] and r['_val'] >= 250_000 and classify_role(r) in ('CEO','President') and r['_spy90'] is not None and r['_spy90'] < 10]),
    ("Excl ARES+MSTR",             [r for r in rows if r['ticker'] not in ('ARES','MSTR')]),
    ("Excl ARES+MSTR + >=$250K",   [r for r in rows if r['ticker'] not in ('ARES','MSTR') and r['_val'] and r['_val'] >= 250_000]),
    ("Excl outliers+>=$250K+C-suite/Dir", [r for r in rows if r['ticker'] not in ('ARES','MSTR') and r['_val'] and r['_val'] >= 250_000 and classify_role(r) in ('CEO','President','Director')]),
]

for label, sub in combos:
    ps(stats(sub), label)

# ─── RETURN DISTRIBUTION ────────────────────────────────────────────────────
print("\n" + SEP)
print("90d RETURN DISTRIBUTION")
print(SEP)

all_r90 = sorted(r['_r90'] for r in rows if r['_r90'] is not None)
n = len(all_r90)
pct_pos = sum(1 for x in all_r90 if x > 0) / n * 100
pct_neg = sum(1 for x in all_r90 if x < 0) / n * 100

def pctile(lst, p):
    idx = max(0, int(len(lst) * p / 100))
    return lst[min(idx, len(lst)-1)]

print(f"  N with 90d data : {n}")
print(f"  Positive        : {pct_pos:.0f}%   Negative: {pct_neg:.0f}%")
print(f"  P10={pctile(all_r90,10):.1f}%  P25={pctile(all_r90,25):.1f}%  P50={pctile(all_r90,50):.1f}%  P75={pctile(all_r90,75):.1f}%  P90={pctile(all_r90,90):.1f}%")
print(f"  Mean={statistics.mean(all_r90):.1f}%  Stdev={statistics.stdev(all_r90):.1f}%")

adj90 = sorted(r['_adj90'] for r in rows if r['_adj90'] is not None)
print(f"\n  Alpha (adjusted_return_90d) — N={len(adj90)}")
print(f"  P10={pctile(adj90,10):.1f}%  P25={pctile(adj90,25):.1f}%  P50={pctile(adj90,50):.1f}%  P75={pctile(adj90,75):.1f}%  P90={pctile(adj90,90):.1f}%")
print(f"  Mean={statistics.mean(adj90):.1f}%  Stdev={statistics.stdev(adj90):.1f}%")

# ─── TOP/WORST TRADES ────────────────────────────────────────────────────────
print("\n" + SEP)
print("TOP 20 TRADES BY ALPHA")
print(SEP)
ranked = sorted([r for r in rows if r['_adj90'] is not None], key=lambda x: x['_adj90'], reverse=True)
print(f"  {'Ticker':<6} {'Insider':<26} {'Role':<18} {'Value':>12}  {'90d':>6}  {'Alpha':>6}  Date")
print("  " + "-"*92)
for r in ranked[:20]:
    val = f"${r['_val']:>12,.0f}" if r['_val'] else "           N/A"
    print(f"  {r['ticker']:<6} {r['insider_name'][:25]:<26} {classify_role(r):<18} {val}  {r['_r90']:>5.1f}%  {r['_adj90']:>5.1f}%  {r['transaction_date']}")

print("\n" + SEP)
print("WORST 10 TRADES BY ALPHA")
print(SEP)
print(f"  {'Ticker':<6} {'Insider':<26} {'Role':<18} {'Value':>12}  {'90d':>6}  {'Alpha':>6}  Date")
print("  " + "-"*92)
for r in ranked[-10:]:
    val = f"${r['_val']:>12,.0f}" if r['_val'] else "           N/A"
    print(f"  {r['ticker']:<6} {r['insider_name'][:25]:<26} {classify_role(r):<18} {val}  {r['_r90']:>5.1f}%  {r['_adj90']:>5.1f}%  {r['transaction_date']}")
