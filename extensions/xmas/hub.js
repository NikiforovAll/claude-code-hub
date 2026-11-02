// Sparse snow over every tab. A canvas above the app frames that takes no clicks. It draws at
// 30 fps at most, stops while the window is hidden, and never starts when the OS asks for less motion.
(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = Object.assign(document.createElement('canvas'), { className: 'xmas-snow', ariaHidden: 'true' });
  const ctx = canvas.getContext('2d');
  const rand = (a, b) => a + Math.random() * (b - a);

  // Three depths: far flakes are small, slow and faint; near ones are larger, faster, and some are crystals.
  const LAYERS = [
    { share: 0.58, r: [0.5, 1.1], v: [7, 13], a: [0.18, 0.34], wind: 0.45 },
    { share: 0.32, r: [1.1, 1.9], v: [15, 26], a: [0.32, 0.55], wind: 0.8 },
    { share: 0.1, r: [2.2, 3.4], v: [30, 44], a: [0.45, 0.7], wind: 1.2, crystal: 0.5 },
  ];

  let w = 0;
  let h = 0;
  let frame = 0;
  let last = 0;
  let clock = rand(0, 1000);
  let light = null;
  let sprites = null;
  let flakes = [];
  let resizing = 0;
  let base = 0;
  let target = 0;
  let level = 0;
  let pace = 1;
  const gust = { v: 0, target: 0, next: rand(6, 14) };

  function sprite(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    draw(g, size / 2);
    return c;
  }

  function makeSprites() {
    const ink = light ? '127,147,163' : '238,243,240';
    const dot = sprite(16, (g, m) => {
      const grad = g.createRadialGradient(m, m, 0, m, m, m);
      grad.addColorStop(0, `rgba(${ink},1)`);
      grad.addColorStop(0.45, `rgba(${ink},0.85)`);
      grad.addColorStop(1, `rgba(${ink},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, m * 2, m * 2);
    });
    const crystal = sprite(24, (g, m) => {
      g.strokeStyle = `rgba(${ink},1)`;
      g.lineWidth = 1;
      g.lineCap = 'round';
      g.translate(m, m);
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -m + 2);
        g.moveTo(0, -m * 0.5);
        g.lineTo(-3, -m * 0.5 - 3);
        g.moveTo(0, -m * 0.5);
        g.lineTo(3, -m * 0.5 - 3);
        g.stroke();
      }
    });
    sprites = { dot, crystal };
  }

  function layerOf() {
    let x = Math.random();
    for (const l of LAYERS) if ((x -= l.share) <= 0) return l;
    return LAYERS[0];
  }

  function flake(top) {
    const l = layerOf();
    return {
      l,
      x: rand(-20, w + 20),
      y: top ? rand(-60, -8) : rand(0, h),
      r: rand(...l.r),
      v: rand(...l.v),
      a: rand(...l.a),
      crystal: Math.random() < (l.crystal ?? 0),
      amp: rand(4, 14),
      f1: rand(0.25, 0.9),
      f2: rand(1.1, 2.3),
      p1: rand(0, Math.PI * 2),
      p2: rand(0, Math.PI * 2),
      rot: rand(0, Math.PI),
      spin: rand(-0.6, 0.6),
    };
  }

  // The canvas stays at 1x on a HiDPI screen: soft dots look the same, and each frame clears and
  // composites a quarter of the pixels.
  function size() {
    resizing = 0;
    w = innerWidth;
    h = innerHeight;
    canvas.width = w;
    canvas.height = h;
    base = Math.round(Math.min(40, Math.max(18, (w * h) / 60000)));
    while (flakes.length < base) flakes.push(flake(false));
    retarget();
  }

  // Busy sessions add up to 80% more flakes. New ones start above the top edge, and spare ones
  // leave only when they fall out at the bottom, so the change never pops.
  function retarget() {
    target = Math.round(base * (1 + level * 0.8));
  }

  // Wind is two slow waves plus a gust now and then, so the drift never settles into one pattern.
  function wind(dt) {
    gust.next -= dt;
    if (gust.next <= 0) {
      gust.target = gust.target ? 0 : rand(-22, 22);
      gust.next = gust.target ? rand(2, 5) : rand(8, 20);
    }
    gust.v += (gust.target - gust.v) * Math.min(1, dt * 0.8);
    return Math.sin(clock * 0.07) * 5 + Math.sin(clock * 0.023 + 1) * 8 + gust.v;
  }

  function draw(now) {
    frame = requestAnimationFrame(draw);
    const dt = Math.min((now - last) / 1000, 0.1);
    if (dt < 1 / 30) return;
    last = now;
    clock += dt;
    const isLight = document.documentElement.dataset.hubMode === 'light';
    if (isLight !== light) {
      light = isLight;
      makeSprites();
    }
    const breeze = wind(dt);
    pace += (1 + level * 0.45 - pace) * Math.min(1, dt * 0.3);
    if (flakes.length < target) flakes.push(flake(true));
    ctx.clearRect(0, 0, w, h);
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      const sway = Math.sin(clock * f.f1 + f.p1) * f.amp + Math.sin(clock * f.f2 + f.p2) * f.amp * 0.3;
      f.y += f.v * pace * dt;
      f.x += (breeze * f.l.wind + sway) * dt;
      if (f.x < -30) f.x += w + 60;
      else if (f.x > w + 30) f.x -= w + 60;
      if (f.y > h + 12) {
        if (flakes.length > target) {
          flakes.splice(i, 1);
          continue;
        }
        Object.assign(f, flake(true));
      }
      ctx.globalAlpha = light ? f.a * 0.85 : f.a;
      if (f.crystal) {
        f.rot += f.spin * dt;
        const s = f.r * 3.4;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.drawImage(sprites.crystal, -s, -s, s * 2, s * 2);
        ctx.restore();
      } else {
        const s = f.r * 2.2;
        ctx.drawImage(sprites.dot, f.x - s, f.y - s, s * 2, s * 2);
      }
    }
  }

  function start() {
    if (frame || document.hidden || motion.matches) return;
    last = performance.now();
    frame = requestAnimationFrame(draw);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  window.ClaudeHub?.mod.on('xmas:activity', ({ data }) => {
    if (typeof data !== 'number') return;
    level = Math.min(1, Math.max(0, data));
    retarget();
  });

  size();
  document.body.appendChild(canvas);
  addEventListener('resize', () => {
    resizing ||= requestAnimationFrame(size);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  motion.addEventListener('change', () => {
    stop();
    ctx.clearRect(0, 0, w, h);
    start();
  });
  start();
})();
