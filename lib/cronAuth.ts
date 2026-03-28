import { NextResponse } from 'next/server'

export function authorizeCron(req: Request): NextResponse | null {
  if (process.env.NODE_ENV === 'development') return null

  const secret = process.env.CRON_SECRET
  const auth   = req.headers.get('authorization')

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
