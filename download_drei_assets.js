const fs = require('fs');
const https = require('https');
const path = require('path');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('Status code: ' + res.statusCode));
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
    }).on('error', reject);
  });
}

async function run() {
  const assets = [
    { url: 'https://raw.githubusercontent.com/pmndrs/drei-assets/master/food/burger.glb', name: 'burger.glb' },
    { url: 'https://raw.githubusercontent.com/pmndrs/drei-assets/master/food/fries.glb', name: 'fries.glb' },
    { url: 'https://raw.githubusercontent.com/pmndrs/drei-assets/master/food/hotdog.glb', name: 'hotdog.glb' }
  ];

  for (const asset of assets) {
    try {
      console.log(`Downloading ${asset.name}...`);
      await downloadFile(asset.url, path.join(__dirname, 'src', 'assets', asset.name));
      console.log(`Success: ${asset.name}`);
    } catch (e) {
      console.log(`Failed for ${asset.name}:`, e.message);
    }
  }
}

run();
