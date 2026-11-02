(() => {
  const mod = window.ClaudeHub?.mod;
  if (!mod) return;

  mod.on('board.rendered', () => {
    const board = document.querySelector('[data-hub-part="board"]');
    if (!board) return;
    const card = '[data-hub-part="task-card"]';
    board.classList.toggle('xmas-all-done', !!board.querySelector(card) && !board.querySelector(`${card}:not(.completed)`));
  });

  // Santa hat in the mascot's own pixel grid (viewBox units), inside its svg so it floats with it.
  const HAT = [
    ['red', 4, -2, 10, 1],
    ['red', 5, -3, 8, 1],
    ['red', 7, -4, 6, 1],
    ['red', 10, -5, 4, 1],
    ['trim', 3, -1, 12, 1],
    ['trim', 14, -6, 2, 2],
  ];
  const svg = document.querySelector('[data-hub-part="idle-mascot"] svg');
  if (svg) {
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    for (const [part, x, y, width, height] of HAT) {
      const r = document.createElementNS(ns, 'rect');
      for (const [k, v] of Object.entries({ x, y, width, height })) r.setAttribute(k, v);
      r.setAttribute('class', `xmas-hat-${part}`);
      g.append(r);
    }
    svg.append(g);
  }

  const footer = document.querySelector('[data-hub-part="sidebar-footer"]');
  function advent() {
    const now = new Date();
    let xmas = new Date(now.getFullYear(), 11, 25);
    if (now.getMonth() === 11 && now.getDate() > 26) xmas = new Date(now.getFullYear() + 1, 11, 25);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((xmas - today) / 86400000);
    const text = days <= 0 ? '★ Merry Christmas' : `★ ${days} ${days === 1 ? 'day' : 'days'} to Christmas`;
    footer?.style.setProperty('--xmas-advent', JSON.stringify(text));
  }
  advent();
  setInterval(advent, 3600000);

  // The hub's snow falls a little faster and thicker while sessions work. The level is a number
  // from 0 to 1 and goes to the hub page only when it changes.
  let level = -1;
  mod.on('activity.rendered', (counts) => {
    if (!counts) return;
    const next = Math.min(counts.active, 4) / 4;
    if (next === level) return;
    level = next;
    mod.send('xmas:activity', level);
  });
})();
