const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '../assets/icon.png');
const out = path.join(__dirname, '../assets');

const icoSizes = [16, 32, 48, 64, 128, 256];
const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
const allSizes = [...new Set([...icoSizes, ...icnsSizes])];

async function generateIcons() {
  if (!fs.existsSync(src)) {
    console.error('[icons] Source not found:', src);
    process.exit(1);
  }
  for (const size of allSizes) {
    await sharp(src)
      .resize(size, size)
      .png()
      .toFile(path.join(out, `icon_${size}.png`));
    console.log(`Generated icon_${size}.png`);
  }
  console.log('Icons generated. Use electron-builder to package.');
}

generateIcons().catch(err => { console.error(err); process.exit(1); });
