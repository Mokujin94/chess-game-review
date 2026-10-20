// Обёртка над Stockfish (WASM) в Web Worker: анализ позиции с MultiPV.
// Оценка нормализуется к точке зрения белых.

export class Engine {
  constructor() {
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
    this.queue = Promise.resolve();
    this.listener = null;
    this.worker.onmessage = (e) => this.listener && this.listener(String(e.data));
    this.ready = this.#init();
  }

  #send(cmd) {
    this.worker.postMessage(cmd);
  }

  #init() {
    return new Promise((resolve) => {
      this.listener = (line) => {
        if (line === 'uciok') {
          this.#send('setoption name MultiPV value 2');
          this.#send('isready');
        } else if (line === 'readyok') {
          this.listener = null;
          resolve();
        }
      };
      this.#send('uci');
    });
  }

  // Возвращает до 2 линий: [{ move, cp?, mate?, pv[] }] — оценка с точки зрения белых.
  analyze(fen, depth = 14) {
    const run = async () => {
      await this.ready;
      const white = fen.split(' ')[1] === 'w';
      const lines = [];
      return new Promise((resolve) => {
        this.listener = (line) => {
          if (line.startsWith('info') && line.includes(' pv ') && line.includes(' score ')) {
            const mpv = Number(/multipv (\d+)/.exec(line)?.[1] ?? 1);
            const cp = /score cp (-?\d+)/.exec(line);
            const mate = /score mate (-?\d+)/.exec(line);
            const pv = line.split(' pv ')[1].trim().split(' ');
            const sign = white ? 1 : -1;
            lines[mpv - 1] = {
              move: pv[0],
              pv,
              cp: cp ? sign * Number(cp[1]) : null,
              mate: mate ? sign * Number(mate[1]) : null,
            };
          } else if (line.startsWith('bestmove')) {
            this.listener = null;
            resolve(lines.filter(Boolean));
          }
        };
        this.#send('ucinewgame');
        this.#send(`position fen ${fen}`);
        this.#send(`go depth ${depth}`);
      });
    };
    this.queue = this.queue.then(run);
    return this.queue;
  }

  terminate() {
    this.worker.terminate();
  }
}
