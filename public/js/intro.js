// Opening sequence, drawn on one canvas:
// 1. the whole screen is a close-up of a red leather ball (with "Welcome" + a loading bar on top)
// 2. once loaded, the red pulls back and turns out to be the ball, delivered down the pitch from the umpire's view
// 3. a left-handed batter (India blue, No. 3) skips down the track and plays a classic lofted cover drive for six;
//    the ball climbs away over cover, the crowd roars and flashes, and the app is revealed.

const ease = { inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), out: (t) => 1 - Math.pow(1 - t, 3), in: (t) => t * t * t };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Delivery timeline (seconds after the zoom-out starts)
const T_ZOOM = 1.0;          // red close-up pulls back to the bowler's hand
const T_PITCH = T_ZOOM + 0.95;
const T_HIT = T_PITCH + 0.1;  // met on the half-volley, just after it pitches
const T_FLY = 1.2;            // seconds the ball is tracked after the hit, climbing away over cover
const T_END = T_HIT + 3.0;    // hold on the celebration, then reveal the app
// ?introspeed=0.2 slows the sequence down (for checking frames)
const SPEED = Math.min(4, Math.max(0.05, +new URLSearchParams(location.search).get("introspeed") || 1));

// World (metres): camera is the umpire behind the bowler's stumps, looking down the pitch.
const CAM_H = 1.65, STUMPS_Z = 21.6, BALL_R = 0.11; // ball drawn ~3x real size so it reads on screen
const P_RELEASE = [0.3, 2.0, 3.6], P_PITCH = [0.22, BALL_R, 17.7], P_HIT = [0.34, 0.42, 18.3];
// the batter: takes guard on the popping crease, body on the leg side (camera left) of a left-hander's stumps,
// then skips 1.4 m down the track to meet the ball on the half-volley
const BAT_Z0 = STUMPS_Z - 1.1, BAT_Z1 = BAT_Z0 - 1.4, BAT_X0 = -0.26, BAT_X1 = -0.08;
const T_STEP0 = T_ZOOM - 0.15, T_STEP1 = T_PITCH - 0.08; // the skip down the track
// after the hit: lofted over cover, i.e. up and away to the off side (camera right), out of the top of the frame
const flyPos = (u) => [P_HIT[0] + 7.5 * u, P_HIT[1] + 8.5 * u - 1.2 * u * u, P_HIT[2] - 6.5 * u];

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
      status.textContent = k < 0.35 ? "Opening the scorebook" : k < 0.75 ? "Reading head-to-head records" : k < 1 ? "Rolling out the globe" : "Ready to research";
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
    // a small jolt as bat meets ball
    const shake = t > T_HIT && t < T_HIT + 0.18 ? (1 - (t - T_HIT) / 0.18) * 3 : 0;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawScene(t);

    const P = ballPos(t), spin = seam + t * 9;
    // dust where it pitches
    if (t > T_PITCH && t < T_PITCH + 0.6) dust(proj(P_PITCH[0], 0, P_PITCH[2]), (t - T_PITCH) / 0.6, (scene.f * 0.5) / P_PITCH[2]);

    if (t < T_ZOOM) {
      // the red close-up pulls back to the ball in the bowler's hand
      const [bx, by] = proj(...P), br = (scene.f * BALL_R) / P[2];
      const u = ease.inOut(clamp(t / T_ZOOM));
      const R0 = Math.hypot(W, H) * 0.9;
      const r = Math.exp(lerp(Math.log(R0), Math.log(br), u));
      ball(lerp(W / 2 + R0 * 0.12, bx, u), lerp(H / 2 + R0 * 0.05, by, u), r, spin, 1);
    } else if (P) {
      const [bx, by] = proj(...P), br = (scene.f * BALL_R) / P[2];
      if (by > -br * 2 && bx < W + br * 2) {
        // shadow (only near the ground) + motion trail + ball
        const [sx, sy] = proj(P[0], 0, P[2]);
        const sh = 0.35 * clamp(1 - (P[1] - BALL_R) / 2);
        if (sh > 0.01) { ctx.fillStyle = `rgba(0,0,0,${sh})`; ctx.beginPath(); ctx.ellipse(sx, sy, br * 1.1, br * 0.35, 0, 0, Math.PI * 2); ctx.fill(); }
        for (let i = 1; i <= 4; i++) {
          const back = ballPos(t - i * (t > T_HIT ? 0.03 : 0.022));
          if (!back || back[2] < 1) continue;
          const [tx, ty] = proj(...back);
          ctx.fillStyle = `rgba(200,16,46,${0.16 - i * 0.03})`;
          ctx.beginPath(); ctx.arc(tx, ty, (scene.f * BALL_R) / back[2], 0, Math.PI * 2); ctx.fill();
        }
        ball(bx, by, br, spin, 1);
      }
    }
    if (t >= T_HIT && !scene.hit) { scene.hit = true; impact(); }
    ctx.restore();

    // a quick flash as it's struck, then "SIX" once the ball has cleared the frame
    if (t > T_HIT && t < T_HIT + 0.12) { ctx.fillStyle = `rgba(255,250,235,${0.18 * (1 - (t - T_HIT) / 0.12)})`; ctx.fillRect(0, 0, W, H); }
    if (t > T_HIT + 0.55) sixCall(clamp((t - T_HIT - 0.55) / 0.35), clamp((T_END - t) / 0.5));
  }
  // where the ball is at time t: release → pitch → bat, then up and away over extra cover
  function ballPos(t) {
    if (t < T_ZOOM) return P_RELEASE;
    if (t < T_PITCH) { const u = (t - T_ZOOM) / (T_PITCH - T_ZOOM); return [lerp(P_RELEASE[0], P_PITCH[0], u), lerp(P_RELEASE[1], P_PITCH[1], u) + 0.35 * u * (1 - u), lerp(P_RELEASE[2], P_PITCH[2], u)]; }
    if (t < T_HIT) { const u = (t - T_PITCH) / (T_HIT - T_PITCH); return [lerp(P_PITCH[0], P_HIT[0], u), lerp(P_PITCH[1], P_HIT[1], u) + 0.2 * u * (1 - u), lerp(P_PITCH[2], P_HIT[2], u)]; }
    const u = (t - T_HIT) / T_FLY;
    return u > 1 ? null : flyPos(u);
  }

  // the big "SIX" call over the stands
  function sixCall(a, out) {
    const alpha = Math.min(ease.out(a), out);
    if (alpha <= 0) return;
    const size = Math.min(W * 0.22, H * 0.2), y = scene.standTop + size * 0.2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${size * (0.9 + 0.1 * ease.out(a))}px ${getComputedStyle(document.documentElement).getPropertyValue("--display") || "Impact, sans-serif"}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,200,80,.55)"; ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = "#fff6dc"; ctx.fillText("SIX", W / 2, y);
    ctx.restore();
  }

  // A left-handed batter seen from the bowler's end, in India blue (No. 3). He skips down the track as the ball is
  // released, bat high, meets it on the half-volley with the front knee bent and a high elbow, and lofts it over
  // cover with a full, high follow-through. Pose keys are interpolated between fixed moments of the delivery.
  function drawBatter(t) {
    // th: bat angle from the hands (0 = straight down, +π/2 = towards cover, ±π = straight up); len: how much of the
    // bat's length shows (it points at the camera mid-swing); hx/hy: hands; hip: hip height; fx/bx: front/back foot
    const keys = [
      [0, { th: 0.25, len: 1, hx: 0.1, hy: 0.92, hip: 0.95, fx: 0.17, bx: -0.17, lean: 0 }],
      [T_STEP0, { th: 0.25, len: 1, hx: 0.1, hy: 0.92, hip: 0.95, fx: 0.17, bx: -0.17, lean: 0 }],
      [T_STEP1, { th: -2.75, len: 1, hx: -0.04, hy: 1.6, hip: 0.93, fx: 0.24, bx: -0.2, lean: -0.04 }],
      [T_HIT - 0.06, { th: -0.7, len: 0.55, hx: 0.12, hy: 1.18, hip: 0.86, fx: 0.34, bx: -0.24, lean: 0.08 }],
      [T_HIT, { th: 0.35, len: 1, hx: 0.3, hy: 0.98, hip: 0.82, fx: 0.38, bx: -0.25, lean: 0.14 }],
      [T_HIT + 0.38, { th: 3.25, len: 1, hx: 0.3, hy: 2.0, hip: 0.9, fx: 0.38, bx: -0.22, lean: 0.06 }],
    ];
    let p = keys.at(-1)[1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [ta, a] = keys[i], [tb, b] = keys[i + 1];
      if (t >= ta && t < tb) {
        const fn = i === 2 ? ease.in : i === 4 ? ease.out : i === 3 ? (x) => x : ease.inOut;
        const u = fn(clamp((t - ta) / (tb - ta)));
        p = Object.fromEntries(Object.keys(a).map((k) => [k, lerp(a[k], b[k], u)]));
        break;
      }
    }
    // down the track: body moves forward (towards the camera) and a touch towards the line of the ball
    const step = ease.inOut(clamp((t - T_STEP0) / (T_STEP1 - T_STEP0)));
    const bz = lerp(BAT_Z0, BAT_Z1, step), bxw = lerp(BAT_X0, BAT_X1, step);
    // two quick skips: front foot leads, back foot follows; the hips bob with each
    const ph = clamp((t - T_STEP0) / (T_STEP1 - T_STEP0));
    const skip = (a, b) => (ph > a && ph < b ? Math.sin(((ph - a) / (b - a)) * Math.PI) : 0);
    const liftF = 0.12 * (skip(0, 0.4) + skip(0.5, 0.85)), liftB = 0.1 * (skip(0.25, 0.6) + skip(0.7, 0.98));
    const hip = p.hip + 0.04 * (skip(0, 0.5) + skip(0.5, 1));

    const [x0, y0] = proj(bxw, 0, bz), s = scene.f / bz;
    const X = (x) => x0 + x * s, Y = (y) => y0 - y * s;
    const seg = (x1, y1, x2, y2, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w * s; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke(); };
    const leg = (hx, fx, lift, kneeOut, trouser) => {
      const kx = lerp(hx, fx, 0.55) + kneeOut, ky = lerp(hip, lift, 0.5) + 0.02;
      seg(hx, hip, kx, ky, 0.15, trouser);         // thigh
      seg(kx, ky + 0.06, fx, lift + 0.06, 0.19, PAD); // pad from just above the knee
      seg(fx - 0.03, lift + 0.03, fx + 0.1, lift + 0.02, 0.1, "#e8e4da"); // shoe
    };
    const BLUE = "#1d4fb3", DEEP = "#123577", PAD = "#f3f1ea", SAFFRON = "#ff8a1f";
    const font = getComputedStyle(document.documentElement).getPropertyValue("--display") || "Impact";
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(X(0.05), Y(0), 0.44 * s, 0.07 * s, 0, 0, 7); ctx.fill();
    const lean = p.lean, sho = hip + 0.5, tx = lean * 0.5;
    // back leg (camera left), then the body, then the front leg bending towards the ball (camera right)
    leg(-0.07 + tx, p.bx, liftB, -0.02, DEEP);
    ctx.fillStyle = BLUE; ctx.beginPath();
    ctx.moveTo(X(tx - 0.14), Y(hip)); ctx.lineTo(X(tx + 0.14), Y(hip)); ctx.lineTo(X(lean + 0.16), Y(sho)); ctx.lineTo(X(lean - 0.16), Y(sho)); ctx.closePath(); ctx.fill();
    seg(lean - 0.15, sho - 0.02, lean + 0.15, sho - 0.02, 0.035, SAFFRON);
    ctx.fillStyle = "#fff"; ctx.font = `800 ${0.14 * s}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("3", X(tx + lean * 0.5), Y((hip + sho) / 2));
    leg(0.07 + tx, p.fx, liftF, Math.max(0, 0.95 - hip) * 1.4, BLUE);
    // back arm, bat, front arm (high elbow), gloves
    const shB = [lean - 0.15, sho - 0.04], shF = [lean + 0.15, sho - 0.04];
    seg(shB[0], shB[1], p.hx - 0.03, p.hy, 0.08, DEEP);
    const L = 0.86 * p.len, dx = Math.sin(p.th), dy = -Math.cos(p.th), hx = p.hx, hy = p.hy;
    seg(hx, hy, hx + dx * 0.28 * p.len, hy + dy * 0.28 * p.len, 0.045, "#2b2b2b"); // grip
    seg(hx + dx * 0.28 * p.len, hy + dy * 0.28 * p.len, hx + dx * L, hy + dy * L, 0.11, "#e8cf96"); // blade
    seg(hx + dx * 0.3 * p.len, hy + dy * 0.3 * p.len, hx + dx * (L - 0.02), hy + dy * (L - 0.02), 0.03, "#c9a865"); // edge
    const elbow = [lerp(shF[0], hx, 0.5) + 0.06, lerp(shF[1], hy, 0.5) + 0.05];
    seg(shF[0], shF[1], elbow[0], elbow[1], 0.08, BLUE); seg(elbow[0], elbow[1], hx + 0.03, hy, 0.075, BLUE);
    ctx.fillStyle = PAD; ctx.beginPath(); ctx.arc(X(hx), Y(hy), 0.06 * s, 0, 7); ctx.fill();
    // helmet with grille, eyes on the ball
    const hdx = lean + 0.02, hdy = sho + 0.17;
    ctx.fillStyle = "#0f1d47"; ctx.beginPath(); ctx.arc(X(hdx), Y(hdy), 0.12 * s, Math.PI, 0); ctx.lineTo(X(hdx + 0.12), Y(hdy - 0.02)); ctx.lineTo(X(hdx - 0.12), Y(hdy - 0.02)); ctx.fill();
    seg(hdx - 0.13, hdy - 0.01, hdx + 0.15, hdy - 0.01, 0.03, "#0f1d47");
    ctx.strokeStyle = "rgba(210,215,225,.85)"; ctx.lineWidth = Math.max(1, 0.012 * s);
    for (const gy of [0.04, 0.08, 0.12]) { ctx.beginPath(); ctx.moveTo(X(hdx - 0.09), Y(hdy - gy)); ctx.lineTo(X(hdx + 0.09), Y(hdy - gy)); ctx.stroke(); }
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
    // the crowd jumps and the camera flashes go off once the ball is on its way into the stands
    const cheer = s.hit ? clamp((t - T_HIT) / 0.25) * clamp(1 - (t - T_HIT - 0.4) / 2.6) : 0;
    for (const c of s.crowd) {
      const jump = cheer ? Math.abs(Math.sin(t * c.f + c.p)) * 3.2 * cheer : 0;
      ctx.fillStyle = c.col; ctx.fillRect(c.x, c.y - jump, c.s, c.s);
      if (cheer && Math.random() < 0.012 * cheer) { ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.arc(c.x, c.y, 2.4, 0, 7); ctx.fill(); }
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
    drawStumps();
    drawBatter(t);
    // vignette so the scene reads as night
    ctx.fillStyle = s.vignette; ctx.fillRect(0, 0, W, H);
    if (fade < 1) { ctx.fillStyle = `rgba(4,6,12,${1 - fade})`; ctx.fillRect(0, 0, W, H); }
  }

  // the far stumps, with bails, behind the batter (they stay standing: the ball goes for six)
  function drawStumps() {
    const [, baseY] = proj(0, 0, STUMPS_Z), [, topY] = proj(0, 0.711, STUMPS_Z);
    const h = baseY - topY, w = Math.max(2, (scene.f * 0.036) / STUMPS_Z);
    for (const x of [-0.111, 0, 0.111]) {
      const [sx] = proj(x, 0, STUMPS_Z);
      const g = ctx.createLinearGradient(sx - w / 2, 0, sx + w / 2, 0); g.addColorStop(0, "#d9c7a0"); g.addColorStop(0.45, "#fff5dc"); g.addColorStop(1, "#bfa979");
      ctx.fillStyle = g; ctx.fillRect(sx - w / 2, topY, w, h);
    }
    const [lx] = proj(-0.111, 0, STUMPS_Z), [rx] = proj(0.111, 0, STUMPS_Z), bh = Math.max(2, w * 0.55);
    ctx.fillStyle = "#f6ead0"; ctx.fillRect(lx, topY - bh, rx - lx, bh);
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
    // the sweet-spot "tok" of willow on leather: a short knock with a bright click on top
    const crack = ac.createBufferSource(), hp = ac.createBiquadFilter(), cg = ac.createGain();
    crack.buffer = noiseBuffer(ac, 0.06); hp.type = "bandpass"; hp.frequency.value = 2100; hp.Q.value = 1.6;
    cg.gain.setValueAtTime(0.55, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    crack.connect(hp).connect(cg).connect(ac.destination); crack.start(t);
    const knock = ac.createOscillator(), tg = ac.createGain();
    knock.type = "sine"; knock.frequency.setValueAtTime(1150, t); knock.frequency.exponentialRampToValueAtTime(560, t + 0.07);
    tg.gain.setValueAtTime(0.4, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    knock.connect(tg).connect(ac.destination); knock.start(t); knock.stop(t + 0.12);
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
