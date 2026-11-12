// Builds a synthetic YouTube Data Tools video list by repeating e2e/fixtures/playlist61.csv
// with unique video ids and varied numbers. Usage: node scripts/generate-perf-fixture.mjs 100000
import fs from 'node:fs';
import path from 'node:path';

const rowCount = Number(process.argv[2] || 10000);
const source = path.resolve('e2e/fixtures/playlist61.csv');
const outDir = path.resolve('e2e/fixtures/perf');
const outFile = path.join(outDir, `videos-${rowCount}.csv`);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const quote = (value) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const [header, ...templates] = parseCsv(fs.readFileSync(source, 'utf8').replace(/^﻿/, ''));
const col = (name) => header.indexOf(name);
const idx = {
  position: col('position'),
  videoId: col('videoId'),
  videoUrl: col('videoUrl'),
  title: col('videoTitle'),
  views: col('viewCount'),
  likes: col('likeCount'),
  channelId: col('channelId'),
  channelTitle: col('channelTitle'),
};

fs.mkdirSync(outDir, { recursive: true });
const out = fs.createWriteStream(outFile);
out.write(`${header.map(quote).join(',')}\n`);
for (let i = 0; i < rowCount; i += 1) {
  const next = [...templates[i % templates.length]];
  const videoId = `perf${String(i).padStart(7, '0')}`;
  const channel = i % 500;
  next[idx.position] = String(i + 1);
  next[idx.videoId] = videoId;
  next[idx.videoUrl] = `https://www.youtube.com/watch?v=${videoId}`;
  next[idx.title] = `${next[idx.title]} #${i}`;
  next[idx.views] = String((i * 7919) % 5_000_000);
  next[idx.likes] = String((i * 104729) % 50_000);
  next[idx.channelId] = `UCperf${String(channel).padStart(4, '0')}`;
  next[idx.channelTitle] = `Perf Channel ${channel}`;
  out.write(`${next.map(quote).join(',')}\n`);
}
out.end(() => console.log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB)`));
