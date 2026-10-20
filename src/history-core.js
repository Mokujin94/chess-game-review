import { Chess } from 'chess.js';

// Важны очередь хода, рокировки и взятие на проходе; счётчики ходов не важны.
export const positionKey = fen => new Chess(fen).fen().split(' ').slice(0, 4).join(' ');
export const placementOf = fen => fen.split(' ')[0];
export function advanceBoard(game, placement) {
  if (placementOf(game.fen()) === placement) return 'same';
  if (placementOf(new Chess().fen()) === placement) { game.reset(); return 'reset'; }
  const candidates = game.moves({ verbose: true }).filter(m => placementOf(m.after) === placement);
  if (candidates.length !== 1) {
    // Быстрый ответ бота может попасть между двумя снимками доски.
    const paths = [];
    for (const first of game.moves({ verbose: true })) {
      const next = new Chess(first.after);
      for (const second of next.moves({ verbose: true })) {
        if (placementOf(second.after) === placement) paths.push([first.san, second.san]);
      }
    }
    if (paths.length !== 1) return 'unsynced';
    for (const san of paths[0]) game.move(san);
    return 'move';
  }
  game.move(candidates[0].san);
  return 'move';
}
