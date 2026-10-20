chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'BOT_BOARD' || !sender.tab || !/^https:\/\/www\.chess\.com\/play\/computer(?:[/?#]|$)/.test(sender.url || '')) return;
  if (!/^[prnbqkPRNBQK1-8/]+$/.test(msg.placement || '') || msg.placement.length > 100) return;
  chrome.tabs.query({ url: ['https://mokujin94.github.io/chess-game-review/*', 'http://localhost:5173/*'] }, tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'BOT_BOARD', placement: msg.placement, sourceTab: sender.tab.id }).catch(() => {});
  });
});
