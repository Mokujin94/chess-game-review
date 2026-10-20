// Дебютная книга на базе lichess-org/chess-openings (CC0): позиция -> {eco, name}.
import { Chess } from 'chess.js';

const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
let book = null;

export async function loadBook() {
  if (book) return book;
  book = new Map();
  const files = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((f) => fetch(`${import.meta.env.BASE_URL}data/${f}.tsv`).then((r) => r.text())),
  );
  for (const text of files) {
    for (const row of text.split('\n').slice(1)) {
      const [eco, name, pgn] = row.split('\t');
      if (!pgn) continue;
      const c = new Chess();
      try {
        c.loadPgn(pgn);
      } catch {
        continue;
      }
      book.set(key(c.fen()), { eco, name });
    }
  }
  return book;
}

export const bookLookup = (map, fen) => map.get(key(fen)) ?? null;
