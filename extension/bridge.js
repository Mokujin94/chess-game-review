chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'BOT_BOARD') window.postMessage({ channel: 'chess-history-bot', ...msg }, location.origin);
});
window.postMessage({ channel: 'chess-history-extension-ready' }, location.origin);
