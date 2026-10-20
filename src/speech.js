// Озвучка через системный синтез речи браузера (Web Speech API). Без внешних сервисов.
// По умолчанию — индийский английский (en-IN), затем хинди (hi-IN), затем любой английский.

const KEY_ON = 'voice_on';
const KEY_VOICE = 'voice_uri';

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
export const supported = Boolean(synth);

function loadVoices() {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    const done = () => resolve(synth.getVoices());
    if (synth.getVoices().length) return done();
    synth.onvoiceschanged = done;
    setTimeout(done, 1500);
  });
}

const rank = (v) => {
  if (/^ru/i.test(v.lang)) return 0;
  if (/^en-IN/i.test(v.lang)) return 1;
  if (/^hi-IN/i.test(v.lang)) return 2;
  if (/^en-GB/i.test(v.lang)) return 3;
  if (/^en/i.test(v.lang)) return 4;
  return 9;
};

// Нейроголоса (edge-tts на сервере проекта) — естественная русская речь.
export const CLOUD_VOICES = [
  { voiceURI: 'cloud:ru-RU-DmitryNeural', cloud: 'ru-RU-DmitryNeural', name: 'Дмитрий · нейроголос', lang: 'ru-RU' },
  { voiceURI: 'cloud:ru-RU-SvetlanaNeural', cloud: 'ru-RU-SvetlanaNeural', name: 'Светлана · нейроголос', lang: 'ru-RU' },
];

// Серверный маршрут есть только в dev-режиме; на статическом хостинге (GitHub Pages) его нет.
export async function cloudAvailable() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/tts?voice=probe&text=a`);
    return r.status === 400;
  } catch {
    return false;
  }
}

export async function getVoices() {
  const all = await loadVoices();
  const sys = all.filter((v) => rank(v) <= 2).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return [...((await cloudAvailable()) ? CLOUD_VOICES : []), ...sys];
}

export const isRussian = (v) => /^ru/i.test(v?.lang ?? '');
export const voiceEnabled = () => localStorage.getItem(KEY_ON) === '1';
export const setVoiceEnabled = (on) => localStorage.setItem(KEY_ON, on ? '1' : '0');
export const savedVoiceUri = () => localStorage.getItem(KEY_VOICE);
export const saveVoiceUri = (uri) => localStorage.setItem(KEY_VOICE, uri);

let audio = null;
let token = 0;

export function stop() {
  token++;
  synth?.cancel();
  if (audio) {
    audio.pause();
    audio = null;
  }
}

function speakSystem(text, voice) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.rate = 0.95;
  u.pitch = 1;
  synth.speak(u);
}

// Нейроголос: запрос к /api/tts, при ошибке — системный русский голос.
export async function speak(text, voice, fallback) {
  stop();
  if (!text) return;
  if (!voice?.cloud) return speakSystem(text, voice);
  const my = token;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/tts?voice=${voice.cloud}&text=${encodeURIComponent(text)}`);
    if (!r.ok) throw new Error(String(r.status));
    const url = URL.createObjectURL(await r.blob());
    if (my !== token) return;
    const a = new Audio(url);
    audio = a;
    a.onended = () => URL.revokeObjectURL(url);
    // плавное нарастание громкости — без щелчка в начале
    a.volume = 0;
    await a.play();
    let v = 0;
    const ramp = setInterval(() => {
      v = Math.min(0.85, v + 0.17);
      if (audio === a) a.volume = v;
      if (v >= 0.85 || audio !== a) clearInterval(ramp);
    }, 40);
  } catch {
    if (my === token) speakSystem(text, fallback);
  }
}

// ---- Подготовка русского текста для синтеза речи ----
const ONES = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const numRu = (n) => (n < 20 ? ONES[n] : n < 100 ? `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}` : n === 100 ? 'сто' : String(n));

function percentWord(n) {
  const l = n % 100;
  const d = n % 10;
  if (l >= 11 && l <= 14) return 'процентов';
  if (d === 1) return 'процент';
  if (d >= 2 && d <= 4) return 'процента';
  return 'процентов';
}

export function prepareRu(text) {
  return text
    .replace(/(\d+)%/g, (_, n) => `${numRu(Number(n))} ${percentWord(Number(n))}`)
    .replace(/\d+/g, (n) => numRu(Number(n)))
    .replace(/[★✓↻💡]/gu, '');
}

// Фонетическая латиница: индийский английский голос читает русскую речь «с акцентом».
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'zh', з: 'z', и: 'ee', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'oo', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export function translit(text) {
  const vowels = 'аеёиоуыэюя';
  let out = '';
  const t = text.toLowerCase();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const prev = t[i - 1] ?? ' ';
    if (c === 'е') out += /[\s\p{P}ьъ]/u.test(prev) || vowels.includes(prev) ? 'ye' : 'e';
    else if (c === 'ё') out += 'yo';
    else out += TR[c] ?? c;
  }
  return out;
}

// Готовый текст для выбранного голоса: русский голос читает кириллицу, индийский — транслит.
export function forVoice(textRu, voice) {
  const t = prepareRu(textRu);
  return isRussian(voice) ? t : translit(t);
}

// Фоновая подготовка озвучки (кэш на сервере): два запроса одновременно, с нужного хода вперёд.
let prefetchRun = 0;
export async function prefetch(items, voice, concurrency = 1) {
  if (!voice?.cloud) return;
  const run = ++prefetchRun;
  const queue = [...items];
  await new Promise((r) => setTimeout(r, 1500)); // не мешаем текущей фразе
  if (run !== prefetchRun) return;
  const worker = async () => {
    while (queue.length && run === prefetchRun) {
      const text = queue.shift();
      try {
        await fetch(`${import.meta.env.BASE_URL}api/tts?voice=${voice.cloud}&text=${encodeURIComponent(text)}`).then((r) => r.blob());
      } catch {
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
