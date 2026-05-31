import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const source = path.join(root, 'src/assets/tulip-flow-brand.png')
const outDir = path.join(root, 'public')
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

await mkdir(outDir, { recursive: true })

/** Turn near-black pixels transparent so the favicon has no black box. */
async function removeBlackBackground(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const threshold = 35
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r <= threshold && g <= threshold && b <= threshold) {
      data[i + 3] = 0
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim()
    .png()
    .toBuffer()
}

const logo = await removeBlackBackground(source)

async function writeFavicon(size, filename) {
  const padding = Math.round(size * 0.06)
  const inner = size - padding * 2

  await sharp(logo)
    .resize(inner, inner, { fit: 'contain', background: transparent })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: transparent,
    })
    .png()
    .toFile(path.join(outDir, filename))
}

await writeFavicon(32, 'favicon-32.png')
await writeFavicon(192, 'favicon-192.png')
await writeFavicon(180, 'apple-touch-icon.png')
await sharp(path.join(outDir, 'favicon-32.png')).toFile(path.join(outDir, 'favicon.png'))

console.log('Favicons written to public/')
