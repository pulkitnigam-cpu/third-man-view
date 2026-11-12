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
const T_PITCH = T_ZOOM + 0.55; // real pace: ~0.55 s from release to pitch
const T_HIT = T_PITCH + 0.035; // smothered on the half-volley, as it rises off the pitch
const T_FLY = 1.2;            // seconds the ball is tracked after the hit, climbing away over cover
const T_END = T_HIT + 3.0;    // hold on the celebration, then reveal the app
// ?introspeed=0.2 slows the sequence down (for checking frames)
const CAM_ZOOM = 2.7;           // how tight the camera goes on the batter
const SPEED = Math.min(4, Math.max(0.05, +new URLSearchParams(location.search).get("introspeed") || 1));

// World (metres): camera is the umpire behind the bowler's stumps, looking down the pitch.
const CAM_H = 1.65, STUMPS_Z = 21.6, BALL_R = 0.11; // ball drawn ~3x real size so it reads on screen
// The batter, as a 3D skeleton in metres. Local axes: x = towards the off side (camera right for a left-hander),
// y = up, z = away from the camera (towards the keeper). He takes guard side-on on the leg side of his stumps, chest
// to the off side, front (right) shoulder pointing down the pitch, then steps out and lofts it over extra cover.
// Joints: fA/fK/fH front ankle/knee/hip, bA/bK/bH back leg, sF/sB shoulders, eF/eB elbows, hd head, hn hands (both on
// the handle). The bat is a direction from the hands: phi turns it in the upright plane along the pitch
// (0 = straight up, 90 = back towards the keeper, 180 = straight down, 270 = forward at the bowler, 360 = up again)
// and dx tilts it towards the off side.
const BAT_X0 = -0.25, BAT_Z0 = STUMPS_Z - 1.1;
const POSE_KEYS = [
  // stance: knees flexed, slight crouch, bat grounded behind the back foot, head level and looking down the pitch
  [0, { fA: [0, 0.08, -0.28], fK: [0.2, 0.47, -0.22], fH: [0, 0.85, -0.1], bA: [0, 0.08, 0.28], bK: [0.18, 0.47, 0.22], bH: [0, 0.85, 0.1],
    sF: [0.24, 1.34, -0.16], sB: [0.18, 1.36, 0.18], hd: [0.26, 1.53, -0.1], hn: [0.42, 0.9, 0.06], eF: [0.38, 1.1, -0.12], eB: [0.34, 1.04, 0.18], phi: 168, dx: 0.06 }],
  [T_ZOOM - 0.45, null], // hold the stance; he starts down the track in the bowler's delivery stride
  // first step: front foot comes up and forward, the bat starts back
  [T_ZOOM - 0.2, { fA: [0, 0.22, -0.78], fK: [0.12, 0.62, -0.56], fH: [0, 0.92, -0.36], bA: [0, 0.08, 0.2], bK: [0.08, 0.5, 0.0], bH: [0, 0.92, -0.16],
    sF: [0.1, 1.45, -0.42], sB: [0.06, 1.45, -0.06], hd: [0.1, 1.65, -0.32], hn: [0.2, 1.22, -0.06], eF: [0.18, 1.3, -0.3], eB: [0.16, 1.2, 0.0], phi: 100, dx: 0 }],
  // front foot down; the back foot skips in behind it; the bat is up
  [T_ZOOM + 0.05, { fA: [-0.05, 0.08, -0.92], fK: [0.05, 0.5, -0.86], fH: [-0.05, 0.9, -0.76], bA: [-0.12, 0.2, -0.46], bK: [-0.04, 0.56, -0.5], bH: [-0.05, 0.9, -0.56],
    sF: [0.02, 1.45, -0.84], sB: [-0.02, 1.45, -0.5], hd: [0.04, 1.65, -0.74], hn: [0.06, 1.5, -0.46], eF: [0.1, 1.46, -0.74], eB: [0.05, 1.36, -0.42], phi: 40, dx: -0.05 }],
  // back foot lands; the front foot lifts for the long final stride, moving slightly to leg to make room
  [T_ZOOM + 0.28, { fA: [-0.1, 0.24, -1.52], fK: [0.02, 0.64, -1.36], fH: [-0.12, 0.9, -1.24], bA: [-0.16, 0.08, -0.8], bK: [-0.06, 0.5, -0.92], bH: [-0.12, 0.9, -1.04],
    sF: [-0.06, 1.45, -1.3], sB: [-0.1, 1.45, -0.98], hd: [-0.04, 1.66, -1.2], hn: [-0.04, 1.56, -0.9], eF: [0.02, 1.5, -1.2], eB: [-0.04, 1.38, -0.86], phi: 30, dx: -0.05 }],
  // the shape: front foot planted pointing to extra cover, front knee bent with the head over it, back leg long on its
  // toe, high front elbow, bat at the top
  [T_HIT - 0.1, { fA: [0.22, 0.08, -2.05], fK: [0.38, 0.5, -1.95], fH: [-0.06, 0.85, -1.7], bA: [-0.2, 0.1, -1.1], bK: [-0.1, 0.48, -1.36], bH: [-0.06, 0.86, -1.5],
    sF: [0.12, 1.38, -1.95], sB: [0, 1.4, -1.62], hd: [0.16, 1.56, -1.95], hn: [0.02, 1.48, -1.56], eF: [0.18, 1.56, -1.86], eB: [0, 1.3, -1.5], phi: 60, dx: 0 }],
  // contact under the eyes, just ahead of the front pad, the face opening towards cover
  [T_HIT, { fA: [0.22, 0.08, -2.05], fK: [0.4, 0.48, -1.97], fH: [-0.04, 0.85, -1.72], bA: [-0.2, 0.12, -1.12], bK: [-0.1, 0.48, -1.38], bH: [-0.04, 0.86, -1.52],
    sF: [0.16, 1.36, -1.98], sB: [0.02, 1.38, -1.66], hd: [0.24, 1.5, -2.0], hn: [0.34, 0.86, -2.12], eF: [0.34, 1.16, -2.06], eB: [0.24, 1.04, -1.86], phi: 190, dx: 0.2 }],
  // the finish: hands high, bat over the top, chest opened to the off side
  [T_HIT + 0.4, { fA: [0.22, 0.08, -2.05], fK: [0.36, 0.52, -1.95], fH: [0, 0.88, -1.75], bA: [-0.2, 0.14, -1.15], bK: [-0.08, 0.5, -1.4], bH: [0, 0.88, -1.55],
    sF: [0.15, 1.42, -1.9], sB: [0.05, 1.42, -1.6], hd: [0.18, 1.6, -1.9], hn: [0.25, 1.95, -1.8], eF: [0.35, 1.7, -1.95], eB: [0.2, 1.7, -1.7], phi: 380, dx: 0.15 }],
];
for (let i = 1; i < POSE_KEYS.length; i++) if (!POSE_KEYS[i][1]) POSE_KEYS[i][1] = POSE_KEYS[i - 1][1];
// the downswing (into contact) accelerates; the follow-through decelerates; everything else eases in and out
const POSE_EASE = (i) => (i === 6 ? (t) => t * t * t : i === 7 ? (t) => 1 - Math.pow(1 - t, 3) : (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2));
// the pose at time t, in world coordinates, with the bat as a unit direction from the hands
function batterPose(t) {
  let p = POSE_KEYS.at(-1)[1];
  for (let i = 0; i < POSE_KEYS.length - 1; i++) {
    const [ta, a] = POSE_KEYS[i], [tb, b] = POSE_KEYS[i + 1];
    if (t >= ta && t < tb) {
      const u = POSE_EASE(i + 1)(Math.min(1, Math.max(0, (t - ta) / (tb - ta))));
      p = Object.fromEntries(Object.keys(a).map((k) => [k, Array.isArray(a[k]) ? a[k].map((v, j) => v + (b[k][j] - v) * u) : a[k] + (b[k] - a[k]) * u]));
      break;
    }
  }
  const W = Object.fromEntries(Object.entries(p).filter(([, v]) => Array.isArray(v)).map(([k, [x, y, z]]) => [k, [BAT_X0 + x, y, BAT_Z0 + z]]));
  const r = (p.phi * Math.PI) / 180, d = [p.dx, Math.cos(r), Math.sin(r)], n = Math.hypot(...d);
  W.bat = d.map((v) => v / n);
  return W;
}
// where the ball meets the bat: the sweet spot at the moment of contact
const SWEET = 0.62;
const P_HIT = (() => { const p = batterPose(T_HIT); return p.hn.map((v, i) => v + p.bat[i] * SWEET); })();
const P_RELEASE = [0.3, 2.0, 3.6], P_PITCH = [P_HIT[0] - 0.03, BALL_R, P_HIT[2] - 0.32];
// after the hit: lofted inside-out over extra cover, i.e. up and away to the off side (camera right), out of the top of the frame
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
    ctx.fillStyle = "#03050b"; ctx.fillRect(0, 0, W, H);
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    // TV-style camera: as the ball is released it zooms in on the batter (from 22 m away he is tiny), holds tight
    // through the step-out, the shape and the shot, then pulls back as the ball sails away
    const zin = ease.inOut(clamp((t - T_ZOOM) / 0.3)), zout = ease.inOut(clamp((t - T_HIT - 0.3) / 0.8));
    const k = 1 + (CAM_ZOOM - 1) * zin - (CAM_ZOOM - 1.35) * zout;
    if (k > 1.001) {
      const [cx, cy] = proj(BAT_X0, 1.05, BAT_Z0 - 1.1);  // the middle of where the batter plays the shot
      const lift = (k - 1) / (CAM_ZOOM - 1);                 // bring him towards the middle of the screen as we zoom
      const ox = cx + (W / 2 - cx) * lift, oy = cy + (H * 0.58 - cy) * lift;
      ctx.translate(ox, oy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    }
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

  // Draws the batter from the 3D pose: every joint goes through the same projection as the pitch, limbs are painted
  // far to near, and line widths shrink with distance, so the side-on stance, the step down the track and the shape
  // at contact all read in true perspective.
  function drawBatter(t) {
    const J = batterPose(t);
    const P = (w) => proj(...w), sc = (z) => scene.f / z;
    const BLUE = "#1d4fb3", DEEP = "#163f93", PAD = "#f3f1ea", SHOE = "#e8e4da", SAFFRON = "#ff8a1f";
    const items = [];
    const line = (a, b, w, col) => { const [x1, y1] = P(a), [x2, y2] = P(b); ctx.strokeStyle = col; ctx.lineWidth = w * sc((a[2] + b[2]) / 2); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const limb = (a, b, w, col) => items.push({ z: (a[2] + b[2]) / 2, draw: () => line(a, b, w, col) });
    const add = (v, w) => v.map((x, i) => x + w[i]);
    const mid = (a, b, k = 0.5) => a.map((v, i) => v + (b[i] - v) * k);
    // shadow on the ground under the feet
    const g = mid(J.fA, J.bA), [gx, gy] = P([g[0], 0, g[2]]), gs = sc(g[2]);
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(gx + 0.08 * gs, gy, 0.45 * gs, 0.08 * gs, 0, 0, 7); ctx.fill();
    // the arc of the swing: fading copies of the blade from the top of the backlift, past the front pad, up to the finish
    if (t > T_HIT - 0.12 && t < T_HIT + 0.55) {
      for (let i = 10; i >= 1; i--) {
        const tp = t - i * 0.018;
        if (tp < T_HIT - 0.12) continue;
        const G = batterPose(tp), a = 0.28 * (1 - i / 11) * clamp((T_HIT + 0.55 - t) / 0.25);
        const toe = G.hn.map((v, j) => v + G.bat[j] * 0.86), grip = G.hn.map((v, j) => v + G.bat[j] * 0.3);
        line(grip, toe, 0.1, `rgba(255,236,190,${a})`);
      }
    }
    // legs: trousers to the knee, pads from just above it, shoes pointing towards the off side
    for (const [A, K, Hp, trouser] of [[J.bA, J.bK, J.bH, DEEP], [J.fA, J.fK, J.fH, BLUE]]) {
      limb(Hp, K, 0.17, trouser);
      limb(mid(Hp, K, 0.75), A, 0.2, PAD);
      limb(A, add(A, [0.14, -0.06, -0.03]), 0.1, SHOE);
    }
    // body: hips to shoulders, side-on, with the saffron trim across the shoulders
    const hip = mid(J.fH, J.bH), sho = mid(J.sF, J.sB);
    limb(hip, sho, 0.27, BLUE);
    limb(J.sB, J.sF, 0.13, BLUE);
    items.push({ z: sho[2] - 0.01, draw: () => line(add(J.sB, [0, 0.03, 0]), add(J.sF, [0, 0.03, 0]), 0.035, SAFFRON) });
    // arms (back arm behind), the bat from the hands, gloves
    limb(J.sB, J.eB, 0.1, DEEP); limb(J.eB, J.hn, 0.09, DEEP);
    const along = (k) => add(J.hn, J.bat.map((v) => v * k));
    limb(along(-0.04), along(0.28), 0.045, "#2b2b2b");
    limb(along(0.28), along(0.86), 0.11, "#e8cf96");
    items.push({ z: J.hn[2] - 0.02, draw: () => line(add(along(0.3), [0.03, 0, 0]), add(along(0.84), [0.03, 0, 0]), 0.03, "#c9a865") });
    limb(J.sF, J.eF, 0.1, BLUE); limb(J.eF, J.hn, 0.09, BLUE);
    items.push({ z: J.hn[2] - 0.05, draw: () => { const [x, y] = P(J.hn); ctx.fillStyle = PAD; ctx.beginPath(); ctx.arc(x, y, 0.065 * sc(J.hn[2]), 0, 7); ctx.fill(); } });
    // helmet, turned to face down the pitch: shell, peak and grille
    items.push({ z: J.hd[2] - 0.08, draw: () => {
      const [x, y] = P(J.hd), r = 0.125 * sc(J.hd[2]);
      ctx.fillStyle = "#0f1d47"; ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(x + r, y + r * 0.2); ctx.lineTo(x - r, y + r * 0.2); ctx.fill();
      ctx.fillRect(x - r * 1.1, y - r * 0.05, r * 2.3, r * 0.22);
      ctx.strokeStyle = "rgba(210,215,225,.9)"; ctx.lineWidth = Math.max(1, r * 0.1);
      for (const gy of [0.35, 0.65, 0.95]) { ctx.beginPath(); ctx.moveTo(x - r * 0.7, y + r * gy); ctx.lineTo(x + r * 0.7, y + r * gy); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x, y + r * 0.2); ctx.lineTo(x, y + r * 1.0); ctx.stroke();
    } });
    items.sort((a, b) => b.z - a.z).forEach((it) => it.draw());
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
