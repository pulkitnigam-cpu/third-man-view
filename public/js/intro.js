// Opening sequence, drawn on one canvas:
// 1. the whole screen is a close-up of a red leather ball (with "Welcome" + a loading bar on top)
// 2. once loaded, the red pulls back and turns out to be the ball, delivered down the pitch from the umpire's view
// 3. it pitches, hits the stumps, bails fly, the crowd roars, and the app is revealed.

const ease = { inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), out: (t) => 1 - Math.pow(1 - t, 3), in: (t) => t * t * t };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Delivery timeline (seconds after the zoom-out starts)
const T_ZOOM = 1.0;          // red close-up pulls back to the bowler's hand
const T_PITCH = T_ZOOM + 0.85;
const T_HIT = T_PITCH + 0.38;
const T_END = T_HIT + 2.4;   // hold on the celebration, then reveal the app
// ?introspeed=0.2 slows the sequence down (for checking frames)
const SPEED = Math.min(4, Math.max(0.05, +new URLSearchParams(location.search).get("introspeed") || 1));

// World (metres): camera is the umpire behind the bowler's stumps, looking down the pitch.
const CAM_H = 1.65, STUMPS_Z = 21.6, BALL_R = 0.11; // ball drawn ~3x real size so it reads on screen
const P_RELEASE = [0.3, 2.0, 3.6], P_PITCH = [0.06, BALL_R, 16.2], P_HIT = [0.0, 0.43, STUMPS_Z - 0.05];

export function playIntro({ ready, name, greeting, short, reduceMotion, getAudio, onDone }) {
  const root = document.getElementById("intro");
  const cv = document.getElementById("introCanvas");
  const ctx = cv.getContext("2d");
  const ui = document.getElementById("introUI");
  const fill = document.getElementById("iFill"), status = document.getElementById("iStatus"), tap = document.getElementById("iTap");
  document.getElementById("iKick").textContent = `Third Man View · ${greeting}`;
  document.getElementById("iHello").textContent = `Welcome, ${name}`;

  let W = 0, H = 0, dpr = 1, scene = null;
  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene = buildScene(W, H);
  };
  resize(); addEventListener("resize", resize);

  let loaded = false, bowling = false, t0 = 0, finished = false, raf = 0, seam = 0;
  const startAt = performance.now();
  const MIN_RED = short ? 0.5 : 3.4; // seconds the welcome screen stays up, at least
  ready.then(() => (loaded = true));
  // safety nets in case animation frames are throttled (background tab, slow device): always move on
  ready.then(() => setTimeout(() => { if (!bowling) bowl(); }, (MIN_RED + 14) * 1000));

  // audio needs a user gesture: any tap/key during the intro unlocks it, and a tap after loading bowls.
  const unlock = () => { try { getAudio(); } catch {} };
  const onTap = () => { unlock(); if (loaded && !bowling && (performance.now() - startAt) / 1000 >= Math.min(MIN_RED, 1.2)) bowl(); };
  root.addEventListener("pointerdown", onTap);
  const onKey = (e) => { if (e.key === "Escape") return finish(); onTap(); };
  addEventListener("keydown", onKey);
  document.getElementById("iSkip").addEventListener("click", (e) => { e.stopPropagation(); finish(); });

  if (reduceMotion) { ready.then(() => setTimeout(finish, 600)); drawRed(0); return; }

  let autoTimer = 0;
  function frame(now) {
    const el = (now - startAt) / 1000;
    if (!bowling) {
      seam += 0.0025;
      drawRed(seam);
      const k = loaded ? clamp(el / MIN_RED) : Math.min(0.9, el / MIN_RED);
      fill.style.width = `${ease.out(k) * 100}%`;
      status.textContent = k < 0.35 ? "Checking today's fixtures" : k < 0.75 ? "Loading head-to-head records" : k < 1 ? "Setting up the globe" : "Ready";
      if (k >= 1 && !tap.classList.contains("on")) {
        tap.classList.add("on");
        // the tap unlocks the sound (browsers block audio until the visitor interacts), so wait for it;
        // bowl silently on its own only if nobody taps for 12 s
        autoTimer = setTimeout(bowl, 12000);
      }
    } else {
      const t = ((now - t0) / 1000) * SPEED;
      drawDelivery(t);
      if (t >= T_END) return finish();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function bowl() {
    if (bowling) return;
    clearTimeout(autoTimer);
    bowling = true; t0 = performance.now();
    setTimeout(finish, (T_END / SPEED + 1.5) * 1000);
    ui.classList.add("away");
    whoosh();
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(autoTimer); cancelAnimationFrame(raf);
    removeEventListener("keydown", onKey); removeEventListener("resize", resize);
    ready.then(() => {
      root.classList.add("go");
      onDone?.();
      setTimeout(() => root.classList.add("gone"), 1300);
    });
  }

  /* ---------- drawing ---------- */
  function proj(X, Y, Z) { return [scene.cx + (scene.f * X) / Z, scene.hy + (scene.f * (CAM_H - Y)) / Z]; }

  function drawRed(rot) {
    const R = Math.hypot(W, H) * 0.9;
    ctx.clearRect(0, 0, W, H);
    ball(W / 2 + R * 0.12, H / 2 + R * 0.05, R, rot, 1);
  }

  function drawDelivery(t) {
    // camera shake on impact
    const shake = t > T_HIT && t < T_HIT + 0.3 ? (1 - (t - T_HIT) / 0.3) * 7 : 0;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawScene(t);

    // ball position
    let X, Y, Z, spin = seam + t * 9;
    if (t < T_ZOOM) { [X, Y, Z] = P_RELEASE; }
    else if (t < T_PITCH) {
      const u = (t - T_ZOOM) / (T_PITCH - T_ZOOM);
      X = lerp(P_RELEASE[0], P_PITCH[0], u); Z = lerp(P_RELEASE[2], P_PITCH[2], u);
      Y = lerp(P_RELEASE[1], P_PITCH[1], u) + 0.35 * u * (1 - u); // slight loop above the straight line
    } else if (t < T_HIT) {
      const u = (t - T_PITCH) / (T_HIT - T_PITCH);
      X = lerp(P_PITCH[0], P_HIT[0], u); Z = lerp(P_PITCH[2], P_HIT[2], u);
      Y = lerp(P_PITCH[1], P_HIT[1], u) + 0.2 * u * (1 - u);
    } else {
      const u = t - T_HIT; // deflects off the stumps and dies away
      X = P_HIT[0] - 0.6 * u; Z = P_HIT[2] - 1.5 * u; Y = Math.max(BALL_R, P_HIT[1] + 0.9 * u - 4.9 * u * u);
    }
    const [bx, by] = proj(X, Y, Z), br = (scene.f * BALL_R) / Z;

    // dust where it pitches
    if (t > T_PITCH && t < T_PITCH + 0.6) dust(proj(P_PITCH[0], 0, P_PITCH[2]), (t - T_PITCH) / 0.6, (scene.f * 0.5) / P_PITCH[2]);

    if (t < T_ZOOM) {
      // the red close-up pulls back to the ball in the bowler's hand
      const u = ease.inOut(clamp(t / T_ZOOM));
      const R0 = Math.hypot(W, H) * 0.9;
      const r = Math.exp(lerp(Math.log(R0), Math.log(br), u));
      ball(lerp(W / 2 + R0 * 0.12, bx, u), lerp(H / 2 + R0 * 0.05, by, u), r, spin, 1);
    } else if (t < T_HIT + 0.9) {
      // shadow + motion trail + ball
      const [sx, sy] = proj(X, 0, Z);
      ctx.fillStyle = `rgba(0,0,0,${0.35 * clamp(1 - (Y - BALL_R) / 2)})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, br * 1.1, br * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      if (t < T_HIT) for (let i = 1; i <= 4; i++) {
        const tt = t - i * 0.022, back = trailPos(tt);
        if (!back) continue;
        const [tx, ty] = proj(...back);
        ctx.fillStyle = `rgba(200,16,46,${0.16 - i * 0.03})`;
        ctx.beginPath(); ctx.arc(tx, ty, (scene.f * BALL_R) / back[2], 0, Math.PI * 2); ctx.fill();
      }
      ball(bx, by, br, spin, t > T_HIT ? clamp(1 - (t - T_HIT) / 0.9) : 1);
    }
    if (t >= T_HIT && !scene.hit) { scene.hit = true; impact(); }
    ctx.restore();

    // white flash on impact
    if (t > T_HIT && t < T_HIT + 0.18) { ctx.fillStyle = `rgba(255,250,235,${0.35 * (1 - (t - T_HIT) / 0.18)})`; ctx.fillRect(0, 0, W, H); }
  }
  function trailPos(t) {
    if (t < T_ZOOM) return null;
    if (t < T_PITCH) { const u = (t - T_ZOOM) / (T_PITCH - T_ZOOM); return [lerp(P_RELEASE[0], P_PITCH[0], u), lerp(P_RELEASE[1], P_PITCH[1], u) + 0.35 * u * (1 - u), lerp(P_RELEASE[2], P_PITCH[2], u)]; }
    const u = (t - T_PITCH) / (T_HIT - T_PITCH); return [lerp(P_PITCH[0], P_HIT[0], u), lerp(P_PITCH[1], P_HIT[1], u) + 0.2 * u * (1 - u), lerp(P_PITCH[2], P_HIT[2], u)];
  }

  // A leather ball: deep red radial shading, grain, and a stitched seam that turns with `rot`.
  function ball(x, y, r, rot, alpha) {
    if (r < 0.5 || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.02, x, y, r);
    g.addColorStop(0, "#ff7a5c"); g.addColorStop(0.18, "#e0302f"); g.addColorStop(0.55, "#b00d27"); g.addColorStop(0.85, "#6e0818"); g.addColorStop(1, "#38040c");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (r > 40) { ctx.globalAlpha = alpha * 0.07; ctx.fillStyle = scene.grain; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.globalAlpha = alpha; }
    // seam: an ellipse whose width changes as the ball spins
    const sw = Math.abs(Math.cos(rot)) * r * 0.42 + r * 0.06, tilt = -0.5;
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
    ctx.strokeStyle = "rgba(245,228,200,.55)"; ctx.lineWidth = Math.max(0.6, r * 0.018);
    ctx.beginPath(); ctx.ellipse(r * 0.08, 0, sw, r * 1.02, 0, 0, Math.PI * 2); ctx.stroke();
    if (r > 14) {
      ctx.strokeStyle = "rgba(250,236,210,.7)"; ctx.lineWidth = Math.max(0.6, r * 0.012);
      for (const side of [-1, 1]) {
        const off = side * r * 0.045, n = Math.min(90, Math.round(r / 6) + 18);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, ex = r * 0.08 + (sw + off) * Math.cos(a), ey = (r * 1.02 + off) * Math.sin(a);
          const nx = Math.cos(a), ny = Math.sin(a), l = r * 0.018;
          ctx.beginPath(); ctx.moveTo(ex - nx * l, ey - ny * l); ctx.lineTo(ex + nx * l, ey + ny * l); ctx.stroke();
        }
      }
    }
    ctx.restore();
    // soft highlight
    const hl = ctx.createRadialGradient(x - r * 0.42, y - r * 0.48, 0, x - r * 0.42, y - r * 0.48, r * 0.6);
    hl.addColorStop(0, "rgba(255,255,255,.22)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawScene(t) {
    const s = scene, fade = clamp((t - 0.15) / 0.6);
    // sky
    ctx.fillStyle = s.sky; ctx.fillRect(0, 0, W, H);
    // floodlight glow
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const L of s.lights) { const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r); g.addColorStop(0, "rgba(255,248,220,.55)"); g.addColorStop(0.2, "rgba(220,230,255,.16)"); g.addColorStop(1, "rgba(120,150,255,0)"); ctx.fillStyle = g; ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2); }
    ctx.restore();
    // stands + crowd
    ctx.fillStyle = s.standFill; ctx.beginPath(); ctx.moveTo(0, s.standTop + 30); ctx.quadraticCurveTo(W / 2, s.standTop - 22, W, s.standTop + 30); ctx.lineTo(W, s.hy + 4); ctx.lineTo(0, s.hy + 4); ctx.fill();
    ctx.strokeStyle = "rgba(200,215,240,.25)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, s.standTop + 30); ctx.quadraticCurveTo(W / 2, s.standTop - 22, W, s.standTop + 30); ctx.stroke();
    const cheer = s.hit ? clamp(1 - (t - T_HIT) / 2.4) : 0;
    for (const c of s.crowd) {
      const jump = cheer ? Math.abs(Math.sin(t * c.f + c.p)) * 2.5 * cheer : 0;
      ctx.fillStyle = c.col; ctx.fillRect(c.x, c.y - jump, c.s, c.s);
      if (cheer && Math.random() < 0.004) { ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.arc(c.x, c.y, 2.2, 0, 7); ctx.fill(); } // camera flashes
    }
    // floodlight towers
    for (const L of s.lights) {
      ctx.strokeStyle = "rgba(150,165,190,.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(L.x, L.y + 8); ctx.lineTo(L.x + L.lean, s.standTop + 20); ctx.stroke();
      ctx.fillStyle = "#fffbe8"; ctx.fillRect(L.x - 14, L.y - 6, 28, 12);
    }
    // sight-screen behind the far stumps
    const [a, b] = [proj(-9, 6, 90), proj(9, 0, 90)];
    ctx.fillStyle = "rgba(235,238,242,.8)"; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    // outfield with mowing stripes
    ctx.fillStyle = s.grass; ctx.fillRect(0, s.hy, W, H - s.hy);
    for (let z = 2; z < 140; z += 6) { const y1 = proj(0, 0, z)[1], y2 = proj(0, 0, z + 3)[1]; if (y1 < s.hy) break; ctx.fillStyle = "rgba(255,255,255,.035)"; ctx.fillRect(0, y2, W, y1 - y2); }
    // pitch
    const pw = 1.52, near = 1.0, far = STUMPS_Z + 1.6;
    const q = [proj(-pw, 0, near), proj(pw, 0, near), proj(pw, 0, far), proj(-pw, 0, far)];
    const pg = ctx.createLinearGradient(0, q[0][1], 0, q[2][1]); pg.addColorStop(0, "#cdb27c"); pg.addColorStop(1, "#a88d5b");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.moveTo(...q[0]); ctx.lineTo(...q[1]); ctx.lineTo(...q[2]); ctx.lineTo(...q[3]); ctx.fill();
    // worn patch where the ball lands
    const [wx, wy] = proj(0, 0, 16.5); ctx.fillStyle = "rgba(120,90,50,.18)"; ctx.beginPath(); ctx.ellipse(wx, wy, (s.f * 0.9) / 16.5, (s.f * 0.12) / 16.5, 0, 0, 7); ctx.fill();
    // creases
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    const line = (x1, z1, x2, z2) => { const p1 = proj(x1, 0, z1), p2 = proj(x2, 0, z2); ctx.lineWidth = Math.max(1, (s.f * 0.05) / ((z1 + z2) / 2)); ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.stroke(); };
    line(-1.83, STUMPS_Z - 1.22, 1.83, STUMPS_Z - 1.22); line(-1.32, STUMPS_Z, 1.32, STUMPS_Z);
    line(-1.32, STUMPS_Z - 1.22, -1.32, STUMPS_Z + 0.6); line(1.32, STUMPS_Z - 1.22, 1.32, STUMPS_Z + 0.6);
    line(-1.83, 2.6, 1.83, 2.6); line(-1.32, 2.6, -1.32, 1.0); line(1.32, 2.6, 1.32, 1.0);
    drawStumps(t);
    // vignette so the scene reads as night
    ctx.fillStyle = s.vignette; ctx.fillRect(0, 0, W, H);
    if (fade < 1) { ctx.fillStyle = `rgba(4,6,12,${1 - fade})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawStumps(t) {
    const hit = t > T_HIT ? t - T_HIT : 0;
    const xs = [-0.111, 0, 0.111];
    const [, baseY] = proj(0, 0, STUMPS_Z), [, topY] = proj(0, 0.711, STUMPS_Z);
    const h = baseY - topY, w = Math.max(2, (scene.f * 0.036) / STUMPS_Z);
    xs.forEach((x, i) => {
      const [sx] = proj(x, 0, STUMPS_Z);
      // middle stump is knocked back hardest; the others splay
      const k = ease.out(clamp(hit / 0.35));
      const ang = [-0.16, 0.05, 0.3][i] * k, squash = i === 1 ? 1 - 0.55 * k : 1 - 0.12 * k;
      ctx.save(); ctx.translate(sx, baseY); ctx.rotate(ang);
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, "#d9c7a0"); g.addColorStop(0.45, "#fff5dc"); g.addColorStop(1, "#bfa979");
      ctx.fillStyle = g; ctx.fillRect(-w / 2, -h * squash, w, h * squash);
      ctx.restore();
    });
    // bails: sit on top, then fly
    const [lx] = proj(-0.111, 0, STUMPS_Z), [rx] = proj(0.111, 0, STUMPS_Z), bw = (rx - lx) / 2 + 1, bh = Math.max(2, w * 0.55);
    for (const [j, x0] of [[0, lx], [1, (lx + rx) / 2]]) {
      let x = x0, y = topY - bh, rot = 0;
      if (hit) {
        // pop up, then drop and settle just behind the stumps
        const vx = (j ? 1.1 : -0.9) * h, vy = -4.6 * h, g = 12 * h, ground = baseY - bh * (1.2 + j);
        const tLand = (-vy + Math.sqrt(vy * vy + 2 * g * (ground - y))) / g, tt = Math.min(hit, tLand);
        x += vx * tt; y += vy * tt + 0.5 * g * tt * tt; rot = (j ? 8 : -7) * tt;
      }
      ctx.save(); ctx.translate(x + bw / 2, y + bh / 2); ctx.rotate(rot); ctx.fillStyle = "#f6ead0"; ctx.fillRect(-bw / 2, -bh / 2, bw, bh); ctx.restore();
    }
  }

  function dust([x, y], u, size) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, d = size * (0.4 + u * 1.4) * (0.6 + ((i * 37) % 10) / 20);
      ctx.fillStyle = `rgba(214,190,140,${0.45 * (1 - u)})`;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y - Math.abs(Math.sin(a)) * d * 0.5, size * 0.12 * (1 - u * 0.5), 0, 7); ctx.fill();
    }
  }

  /* ---------- sound ---------- */
  function noiseBuffer(ac, sec) {
    const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function whoosh() {
    let ac; try { ac = getAudio(); } catch { return; }
    const t = ac.currentTime + T_ZOOM * 0.8, src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuffer(ac, 0.6); bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.25); g.gain.linearRampToValueAtTime(0, t + 0.55);
    src.connect(bp).connect(g).connect(ac.destination); src.start(t);
  }
  function impact() {
    let ac; try { ac = getAudio(); } catch { return; }
    const t = ac.currentTime;
    // wooden crack of the stumps
    const crack = ac.createBufferSource(), hp = ac.createBiquadFilter(), cg = ac.createGain();
    crack.buffer = noiseBuffer(ac, 0.12); hp.type = "bandpass"; hp.frequency.value = 2600; hp.Q.value = 0.9;
    cg.gain.setValueAtTime(0.5, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    crack.connect(hp).connect(cg).connect(ac.destination); crack.start(t);
    const thud = ac.createOscillator(), tg = ac.createGain();
    thud.frequency.setValueAtTime(220, t); thud.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    tg.gain.setValueAtTime(0.35, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    thud.connect(tg).connect(ac.destination); thud.start(t); thud.stop(t + 0.2);
    // crowd roar: several noise bands, wobbling like many voices, swelling then fading
    const dur = 3.6, master = ac.createGain();
    master.gain.setValueAtTime(0, t + 0.05); master.gain.linearRampToValueAtTime(0.32, t + 0.45); master.gain.setValueAtTime(0.3, t + 1.5); master.gain.linearRampToValueAtTime(0, t + dur);
    master.connect(ac.destination);
    for (const [f, q, gv] of [[350, 0.8, 0.5], [800, 1, 0.7], [1500, 1.2, 0.5], [2600, 1.5, 0.25]]) {
      const n = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      n.buffer = noiseBuffer(ac, dur); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q; g.gain.value = gv;
      lfo.frequency.value = 4 + Math.random() * 5; lg.gain.value = gv * 0.35; lfo.connect(lg).connect(g.gain);
      n.connect(bp).connect(g).connect(master); n.start(t); lfo.start(t); lfo.stop(t + dur);
    }
    // applause: lots of short claps
    for (let i = 0; i < 90; i++) {
      const at = t + 0.2 + Math.random() * 2.6, c = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      c.buffer = noiseBuffer(ac, 0.03); f.type = "highpass"; f.frequency.value = 1200 + Math.random() * 1500;
      g.gain.setValueAtTime(0.05 * (1 - (at - t) / 3.2), at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      c.connect(f).connect(g).connect(ac.destination); c.start(at);
    }
    // a couple of whistles
    for (const [d, f0, f1] of [[0.35, 1900, 2700], [0.9, 2300, 1800]]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f0, t + d); o.frequency.linearRampToValueAtTime(f1, t + d + 0.35);
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.035, t + d + 0.05); g.gain.linearRampToValueAtTime(0, t + d + 0.4);
      o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.45);
    }
  }
}

// Static parts of the stadium, rebuilt on resize.
function buildScene(W, H) {
  const f = Math.min(H * 2.3, W * 1.6), hy = H * 0.36, cx = W / 2, standTop = hy - H * 0.2;
  const ctx = document.createElement("canvas").getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, hy); sky.addColorStop(0, "#03050b"); sky.addColorStop(1, "#0d1730");
  const standFill = ctx.createLinearGradient(0, standTop, 0, hy); standFill.addColorStop(0, "#151b2a"); standFill.addColorStop(1, "#0a0e18");
  const grass = ctx.createLinearGradient(0, hy, 0, H); grass.addColorStop(0, "#0d3a20"); grass.addColorStop(0.5, "#16582f"); grass.addColorStop(1, "#1d6a39");
  const vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.85); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,.55)");
  const lights = [0.06, 0.24, 0.76, 0.94].map((p, i) => ({ x: W * p, y: standTop - H * (i === 0 || i === 3 ? 0.14 : 0.17), r: Math.max(W, H) * 0.32, lean: (i < 2 ? 1 : -1) * 6 }));
  const crowd = [], cols = ["rgba(230,230,240,.55)", "rgba(46,123,255,.55)", "rgba(255,153,51,.5)", "rgba(180,190,210,.4)", "rgba(255,205,0,.45)", "rgba(60,200,120,.4)"];
  const n = Math.round((W * (hy - standTop)) / 34);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, edge = standTop + 30 - (1 - Math.pow((x - W / 2) / (W / 2), 2)) * 52;
    const y = edge + 6 + Math.random() * (hy - edge - 10);
    crowd.push({ x, y, s: 1.4 + Math.random() * 1.6, col: cols[(Math.random() * cols.length) | 0], f: 10 + Math.random() * 10, p: Math.random() * 6 });
  }
  // leather grain texture for the close-up
  const gc = document.createElement("canvas"); gc.width = gc.height = 160; const g2 = gc.getContext("2d");
  for (let i = 0; i < 2600; i++) { g2.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g2.fillRect(Math.random() * 160, Math.random() * 160, 1.2, 1.2); }
  const grain = ctx.createPattern(gc, "repeat");
  return { f, hy, cx, standTop, sky, standFill, grass, vignette, lights, crowd, grain, hit: false };
}
