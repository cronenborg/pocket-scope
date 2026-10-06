// Renders the PNG app icons Chrome needs for a real (WebAPK) install.
// Run after editing public/icon.svg or public/icon-maskable.svg: node scripts/icons.mjs
import sharp from 'sharp';

const jobs = [
  ['public/icon.svg', 'public/icon-192.png', 192],
  ['public/icon.svg', 'public/icon-512.png', 512],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512],
];
for (const [src, out, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(out);
  console.log(out);
}
