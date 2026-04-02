import { NextResponse } from 'next/server'

export function authorizeCron(req: Request): NextResponse | null {
  if (process.env.NODE_ENV === 'development') return null

  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth        = req.headers.get('authorization')
  const querySecret = new URL(req.url).searchParams.get('secret')

  if (auth === `Bearer ${secret}` || querySecret === secret) return null

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
