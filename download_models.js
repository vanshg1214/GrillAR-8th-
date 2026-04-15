const https = require('https');
const fs = require('fs');
const path = require('path');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Node.js' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('Failed, status code ' + res.statusCode));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function searchAndDownload(query, filename) {
  const searchUrl = `https://api.github.com/search/code?q=${query}+extension:glb+size:<5000000`;
  console.log(`Searching for ${query}...`);
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 Node.js' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    if (data && data.items && data.items.length > 0) {
      for (const item of data.items) {
        const rawUrl = item.html_url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        console.log(`Found: ${rawUrl}`);
        console.log(`Downloading ${filename}...`);
        try {
          await download(rawUrl, path.join(__dirname, 'src', 'assets', filename));
          console.log(`Success: ${filename}`);
          return;
        } catch (e) {
          console.error(`Download failed: ${e.message}, trying next...`);
        }
      }
    } else {
      console.log(`No results for ${query}`);
    }
  } catch (err) {
    console.error(`Error for ${query}:`, err.message);
  }
}

async function run() {
  await searchAndDownload('burger', 'burger.glb');
  await new Promise(r => setTimeout(r, 3000));
  await searchAndDownload('fries', 'fries.glb');
  await new Promise(r => setTimeout(r, 3000));
  await searchAndDownload('hotdog', 'hotdog.glb');
}

run();
