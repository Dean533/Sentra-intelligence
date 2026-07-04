import sharp from 'sharp'
import * as path from 'path'
import * as fs from 'fs'

const PUBLIC = path.join(__dirname, '..', 'public')
const APP    = path.join(__dirname, '..', 'app')

// Source: apple-touch-icon.png is the highest-res PNG the user drops on each update
const SOURCE = path.join(PUBLIC, 'apple-touch-icon.png')

async function circularPng(size: number): Promise<Buffer> {
  const r = size / 2
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" /></svg>`
  )
  return sharp(SOURCE)
    .trim({ background: '#000000', threshold: 15 })  // strip black padding so logo fills the canvas
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function main() {
  const sizes: { file: string; size: number }[] = [
    { file: 'favicon-16x16.png',          size: 16  },
    { file: 'favicon-32x32.png',          size: 32  },
    { file: 'apple-touch-icon.png',       size: 180 },
    { file: 'android-chrome-192x192.png', size: 192 },
    { file: 'android-chrome-512x512.png', size: 512 },
  ]

  for (const { file, size } of sizes) {
    const buf = await circularPng(size)
    fs.writeFileSync(path.join(PUBLIC, file), buf)
    console.log(`  wrote public/${file}  (${buf.length} bytes)`)
  }

  // favicon.ico — write as 32×32 PNG in ICO container
  // Most browsers read the first PNG entry; fallback ICO format is irrelevant
  const ico32 = await circularPng(32)
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico32)
  console.log(`  wrote public/favicon.ico  (32×32 circular PNG)`)

  // app/favicon.ico shadows public/favicon.ico in Next.js App Router
  fs.writeFileSync(path.join(APP, 'favicon.ico'), ico32)
  console.log(`  wrote app/favicon.ico`)

  console.log('\nDone — all favicons are now circular.')
}

main().catch(e => { console.error(e); process.exit(1) })
