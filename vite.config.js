import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Нейроголос через edge-tts (Python): /api/tts?text=...&voice=ru-RU-DmitryNeural -> mp3 с кэшем на диске.
const VOICES = new Set(['ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural']);

function ttsPlugin() {
  const dir = path.join(root, '.tts-cache');
  const bin = path.join(root, '.venv/bin/edge-tts');
  const inflight = new Map();
  fs.mkdirSync(dir, { recursive: true });
  return {
    name: 'edge-tts',
    configureServer(server) {
      server.middlewares.use('/api/tts', (req, res) => {
        const u = new URL(req.url, 'http://localhost');
        const text = (u.searchParams.get('text') ?? '').slice(0, 700);
        const voice = u.searchParams.get('voice') ?? 'ru-RU-DmitryNeural';
        if (!text || !VOICES.has(voice)) {
          res.statusCode = 400;
          return res.end('bad request');
        }
        const file = path.join(dir, `${createHash('sha1').update(`v2|${voice}|${text}`).digest('hex')}.mp3`);
        const send = () => {
          res.setHeader('Content-Type', 'audio/mpeg');
          fs.createReadStream(file).pipe(res);
        };
        if (fs.existsSync(file)) return send();
        if (!inflight.has(file)) {
          const tmp = `${file}.part`;
          inflight.set(
            file,
            new Promise((resolve) => {
              const p = spawn('nice', ['-n', '15', bin, '--voice', voice, '--volume=-12%', `--text=${text}`, '--write-media', tmp]);
              p.on('error', () => resolve(false));
              p.on('close', (code) => {
                if (code === 0 && fs.existsSync(tmp)) {
                  fs.renameSync(tmp, file);
                  resolve(true);
                } else resolve(false);
              });
            }).finally(() => inflight.delete(file)),
          );
        }
        inflight.get(file).then((ok) => {
          if (ok) return send();
          res.statusCode = 502;
          res.end('tts failed');
        });
      });
    },
  };
}

export default {
  base: process.env.BASE_PATH ?? '/',
  plugins: [ttsPlugin()],
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
};
