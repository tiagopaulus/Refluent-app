const sharp = require('sharp');
const _pngToIco = require('png-to-ico');
const pngToIco = typeof _pngToIco === 'function' ? _pngToIco : (_pngToIco.default || _pngToIco);
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '../assets/icon.png');
const out = path.join(__dirname, '../assets');

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

async function generateIcons() {
  if (!fs.existsSync(src)) {
    console.error('[icons] Source not found:', src);
    process.exit(1);
  }

  for (const size of sizes) {
    const inset = Math.round(size * 0.8);
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 8, g: 10, b: 12, alpha: 1 } // #080a0c
      }
    })
      .composite([{
        input: await sharp(src).resize(inset, inset).png().toBuffer(),
        gravity: 'center'
      }])
      .png()
      .toFile(path.join(out, `icon_${size}.png`));
    console.log(`Generated icon_${size}.png`);
  }

  // Composite 1024px version saved as the app icon
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 8, g: 10, b: 12, alpha: 1 }
    }
  })
    .composite([{
      input: await sharp(src).resize(820, 820).png().toBuffer(),
      gravity: 'center'
    }])
    .png()
    .toFile(path.join(out, 'icon_with_bg.png'));

  console.log('Done — use icon_with_bg.png as the app icon');

  // Bundle a multi-size .ico for Windows (NSIS installer + app icon)
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = [];
  for (const s of icoSizes) {
    const logoBuf = await sharp(src).resize(Math.round(s * 0.8), Math.round(s * 0.8)).png().toBuffer();
    const composited = await sharp({
      create: { width: s, height: s, channels: 4, background: { r: 8, g: 10, b: 12, alpha: 1 } }
    })
      .composite([{ input: logoBuf, gravity: 'center' }])
      .png()
      .toBuffer();
    icoBuffers.push(composited);
  }
  const icoData = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(out, 'icon.ico'), icoData);
  console.log('Wrote icon.ico');
}

generateIcons().catch(err => { console.error(err); process.exit(1); });
