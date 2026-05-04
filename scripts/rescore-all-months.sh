#!/usr/bin/env bash
# Rescores insider_signals_monthly for every month from 2015-01 to 2026-04.
# Reads VERCEL_URL and CRON_SECRET from .env.local in the project root.
# Usage: bash scripts/rescore-all-months.sh
# Estimated runtime: 136 months × 30s sleep = ~68 minutes, plus server time.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env.local not found at $ENV_FILE"
  exit 1
fi

# Parse .env.local — strips surrounding quotes, skips comments and blank lines
parse_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '\r' | sed "s/^['\"]//;s/['\"]$//"
}

if [[ -z "${VERCEL_URL:-}" ]]; then
  VERCEL_URL="$(parse_env 'VERCEL_URL')"
fi
if [[ -z "${CRON_SECRET:-}" ]]; then
  CRON_SECRET="$(grep -E "^CRON_SECRET=" "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '\r' | sed "s/^['\"]//;s/['\"]$//")"
fi

if [[ -z "$VERCEL_URL" ]]; then
  echo "ERROR: VERCEL_URL not found in .env.local"
  exit 1
fi
if [[ -z "$CRON_SECRET" ]]; then
  echo "ERROR: CRON_SECRET not found in .env.local"
  exit 1
fi

# Strip trailing slash
VERCEL_URL="${VERCEL_URL%/}"

echo "Target: $VERCEL_URL"
echo "Months: 2015-01 → 2026-04"
echo ""

SLEEP_SECS=30
START_YEAR=2015
START_MONTH=1
END_YEAR=2026
END_MONTH=4

year=$START_YEAR
month=$START_MONTH

while [[ $year -lt $END_YEAR || ( $year -eq $END_YEAR && $month -le $END_MONTH ) ]]; do
  month_str=$(printf "%04d-%02d" "$year" "$month")

  echo "──────────────────────────────────────────"
  echo "$(date '+%H:%M:%S')  Rescoring $month_str ..."

  response=$(curl -s -L -w "\n%{http_code}" \
    -X GET "${VERCEL_URL}/api/insider/signals-monthly?month=${month_str}" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    --max-time 120)

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  echo "  HTTP $http_code"
  echo "  $body"

  if [[ "$http_code" != "200" ]]; then
    echo "  WARNING: non-200 response for $month_str — continuing"
  fi

  # Advance to next month
  if [[ $month -eq 12 ]]; then
    month=1
    year=$((year + 1))
  else
    month=$((month + 1))
  fi

  # Skip sleep after the last month
  if [[ $year -lt $END_YEAR || ( $year -eq $END_YEAR && $month -le $END_MONTH ) ]]; then
    echo "  Sleeping ${SLEEP_SECS}s ..."
    sleep "$SLEEP_SECS"
  fi
done

echo ""
echo "══════════════════════════════════════════"
echo "Done. All months rescored."
