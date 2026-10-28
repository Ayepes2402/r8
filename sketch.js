// ¿Por qué hacerlo? — Reto 8 (IA con copias imperfectas e imprecisas)

const strokes = [], swarms = [], particles = [], dust = [];
const messages = [
  "El esfuerzo empieza donde aparece una decisión.",
  "Copiar es rápido. Elegir qué conservar exige presencia.",
  "La máquina aproxima tu gesto; no puede aproximar tu intención.",
  "Cuanto más humano es tu trazo, más imperfecta resulta la copia."
];
const MODE_LABEL = { continue: "IA COMPLEMENTANDO", mirror: "IA REFLEJANDO", bloom: "IA EXPERIMENTANDO" };
const BLUE = [49, 85, 217];
const MAX_SWARMS = 10;

let active = null, tool = "pen", ink = "#ff4d25", brushSize = 8, aiMode = "continue";
let note = null, noteStats = null, tick = 0, ghost, statusText = "";
let wind = { x: 0, y: 0 };

const $ = id => document.getElementById(id);

function setup() {
  let cnv = createCanvas(windowWidth, windowHeight);
  cnv.position(0, 0);
  cnv.style('z-index', '1');
  cnv.style('pointer-events', 'auto');

  pixelDensity(min(displayDensity(), 2));
  makeGhost();
  for (let i = 0; i < 90; i++) dust.push({ x: random(), y: random(), s: random(0.4, 1.4) });
  setupControls();
  updateLabels();
}

function makeGhost() {
  ghost = createGraphics(windowWidth, windowHeight);
  ghost.pixelDensity(min(displayDensity(), 2));
  redrawGhost();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  makeGhost();
}

function draw() {
  clear();
  tick += 0.003;

  wind.x *= 0.9;
  wind.y *= 0.9;

  image(ghost, 0, 0, width, height);
  strokes.forEach(drawHuman);
  swarms.forEach(updateSwarm);
  swarms.forEach(drawSwarm);
  updateParticles();
  setStatus(swarms.some(w => !w.done) ? "IA INTENTANDO COPIAR…" : MODE_LABEL[aiMode]);
}

function drawHuman(s) {
  const P = s.points;
  push();
  strokeCap(ROUND);

  P.forEach(p => {
    p.x += wind.x * 0.1;
    p.y += wind.y * 0.1;
  });

  if (s.tool === "dotted") {
    noStroke(); fill(s.ink);
    P.forEach((p, i) => { if (i % 2 === 0) circle(p.x, p.y, s.size * 0.8 * p.w); });
  } else {
    noFill(); stroke(s.ink);
    const offsets = s.tool === "ribbon" ? [-1, 1] : [0];
    for (const o of offsets) {
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], dx = b.x - a.x, dy = b.y - a.y;
        const l = max(1, Math.hypot(dx, dy)), k = s.size * 0.45 * o;
        strokeWeight(s.size * (s.tool === "ribbon" ? 0.5 : 1) * (a.w + b.w) / 2);
        line(a.x - dy / l * k, a.y + dx / l * k, b.x - dy / l * k, b.y + dx / l * k);
      }
    }
  }

  // Anillos de pausa / duda humana
  P.forEach(p => {
    if (p.dt > 140) {
      const r = s.size * 0.8 + min(p.dt, 900) / 18, c = color(s.ink);
      c.setAlpha(60); noStroke(); fill(c); circle(p.x, p.y, s.size * 1.4);
      c.setAlpha(120); noFill(); stroke(c); strokeWeight(1); circle(p.x, p.y, r * 1.5);
    }
  });
  pop();
}

function stats(s) {
  const P = s.points;
  return { sec: (P.at(-1).t - P[0].t) / 1000, pauses: P.filter(p => p.dt > 140).length };
}

function resample(pts, step) {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= step) { out.push(pts[i]); acc = 0; }
  }
  if (out.at(-1) !== pts.at(-1)) out.push(pts.at(-1));
  return out;
}

function startSwarm(s) {
  const rawPath = resample(s.points, 12);
  if (rawPath.length < 2) return;

  let length = 0;
  rawPath.forEach((p, i) => {
    if (i) length += p5.Vector.dist(createVector(p.x, p.y), createVector(rawPath[i-1].x, rawPath[i-1].y));
  });

  // GENERAR RUTA IMPERFECTA: La IA deforma los puntos acumulando error y reaccionando a las dudas
  let accumulatedError = createVector(0, 0);
  const imperfectPath = rawPath.map((p, idx) => {
    let px = p.x, py = p.y;
    if (aiMode === "mirror") {
      px = width - px;
      py = height - py;
    }

    // Aumentar la imperfección a lo largo del trazo
    let driftFactor = map(idx, 0, rawPath.length, 3, 22);
    let noiseX = (noise(idx * 0.15, frameCount * 0.05) - 0.5) * driftFactor;
    let noiseY = (noise(idx * 0.15 + 100, frameCount * 0.05) - 0.5) * driftFactor;

    // Si el humano hizo una pausa, la IA sufre una deformación brusca
    if (p.dt > 140) {
      noiseX += random(-25, 25);
      noiseY += random(-25, 25);
    }

    accumulatedError.add(noiseX * 0.1, noiseY * 0.1);
    return createVector(px + noiseX + accumulatedError.x, py + noiseY + accumulatedError.y);
  });

  const agents = [];
  // 3 hebras/líneas que intentan copiar la misma ruta con variaciones
  for (let i = 0; i < 3; i++) {
    agents.push({
      pos: imperfectPath[0].copy().add(p5.Vector.random2D().mult(random(2, 8))),
      vel: createVector(0, 0),
      idx: 0,
      done: false,
      hist: [], full: [],
      wobbleSeed: random(1000)
    });
  }

  const human = stats(s);
  swarms.push({
    kind: "copy",
    mode: aiMode,
    src: s,
    path: imperfectPath,
    agents,
    human,
    frames: 0,
    done: false,
    speed: constrain(length / 30, 5, 11)
  });
  trimSwarms();
}

function trimSwarms() {
  let trimmed = false;
  while (swarms.length > MAX_SWARMS) { swarms.shift(); trimmed = true; }
  if (trimmed) redrawGhost();
}

function updateSwarm(w) {
  if (w.done) return;
  if (w.agents.some(a => !a.done)) w.frames++;
  w.agents.forEach(a => { if (!a.done) stepAgent(w, a); });
  if (w.agents.every(a => a.done)) finishSwarm(w);
}

function stepAgent(w, a) {
  const P = w.path, n = P.length;

  if (a.idx < n) {
    const target = P[a.idx];
    const d = p5.Vector.dist(a.pos, target);

    // Mover hacia el objetivo imperfecto agregando un leve temblor mecánico
    let wobble = createVector(
      sin(frameCount * 0.1 + a.wobbleSeed) * 1.5,
      cos(frameCount * 0.1 + a.wobbleSeed) * 1.5
    );

    let desired = p5.Vector.sub(target, a.pos).add(wobble).setMag(w.speed);
    a.vel.lerp(desired, 0.25);
    a.pos.add(a.vel);

    a.hist.push({ x: a.pos.x, y: a.pos.y });
    a.full.push({ x: a.pos.x, y: a.pos.y });
    if (a.hist.length > 20) a.hist.shift();

    if (d < w.speed * 1.3) {
      a.idx++;
    }
  } else {
    endAgent(w, a);
  }
}

function endAgent(w, a) {
  a.done = true;
  paintTrail(a);
}

function finishSwarm(w) {
  w.done = true;
  if (w.mode === "bloom") {
    burst(w.path[w.path.length - 1]);
  }
  
  // Calcular porcentaje realista de imprecisión
  const fidelity = floor(random(62, 84));
  noteStats = { you: w.human.sec, machine: w.frames / 60, fid: fidelity, pauses: w.human.pauses };
  const p = noteStats.pauses;
  
  note = `Tu trazo tomó ${noteStats.you.toFixed(1)} s (${p} ${p === 1 ? "pausa" : "pausas"}). ` +
    `La IA intentó replicarlo en ${noteStats.machine.toFixed(1)} s pero solo alcanzó un ${fidelity}% de fidelidad.`;
  updateLabels();
}

function drawSwarm(w) {
  noFill();
  for (const a of w.agents) {
    if (a.done) continue;
    stroke(BLUE[0], BLUE[1], BLUE[2], 130); 
    strokeWeight(1.5);
    beginShape(); 
    a.hist.forEach(h => vertex(h.x, h.y)); 
    endShape();
    noStroke(); 
    fill(BLUE[0], BLUE[1], BLUE[2]); 
    circle(a.pos.x, a.pos.y, 3);
  }
}

function paintTrail(a) {
  ghost.noFill(); 
  ghost.stroke(BLUE[0], BLUE[1], BLUE[2], 75); 
  ghost.strokeWeight(1.2);
  ghost.beginShape(); 
  a.full.forEach(h => ghost.vertex(h.x, h.y)); 
  ghost.endShape();
}

function redrawGhost() {
  ghost.clear();
  swarms.forEach(w => w.agents.forEach(a => { if (a.done) paintTrail(a); }));
}

function burst(pos) {
  for (let i = 0; i < 8; i++) particles.push({ pos: pos.copy(), vel: p5.Vector.random2D().mult(random(1, 3)), life: 40, max: 40 });
}

function updateParticles() {
  noStroke();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vel.mult(0.95);
    p.pos.add(p.vel);
    
    fill(p.color ? p.color : color(BLUE[0], BLUE[1], BLUE[2], 180 * p.life / p.max));
    circle(p.pos.x, p.pos.y, (p.size || 2) * (p.life / p.max));
    if (--p.life <= 0) particles.splice(i, 1);
  }
}

function eraseAt(x, y) {
  const r = 28;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    s.points = s.points.filter(p => {
      let d = dist(x, y, p.x, p.y);
      if (d < r) {
        for (let k = 0; k < 2; k++) {
          particles.push({
            pos: createVector(p.x, p.y),
            vel: p5.Vector.random2D().mult(random(1, 3)),
            life: 30, max: 30,
            size: random(2, 4),
            color: color(17, 19, 24, 120)
          });
        }
        return false;
      }
      return true;
    });
    if (s.points.length < 2) strokes.splice(i, 1);
  }
}

function setStatus(text) {
  if (text === statusText) return;
  statusText = text;
  document.querySelector(".status span").textContent = text;
}

function setupControls() {
  let pointerId = null;

  const overUI = (x, y) => {
    const tools = document.querySelector(".tools").getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    let inTools = (x >= tools.left && x <= tools.right && y >= tools.top && y <= tools.bottom);
    let inTopbar = (y <= topbar.bottom);
    return inTools || inTopbar;
  };

  window.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (overUI(e.clientX, e.clientY)) return;
    
    pointerId = e.pointerId;

    if (tool === "eraser") {
      eraseAt(e.clientX, e.clientY);
    } else {
      active = { points: [{ x: e.clientX, y: e.clientY, t: performance.now(), w: 1, dt: 0 }], tool, ink, size: brushSize };
      strokes.push(active);
    }
    
    let hint = $("drawHint");
    if (hint) hint.classList.add("hidden");
  }, { passive: true });

  window.addEventListener("pointermove", e => {
    if (e.pointerId !== pointerId) return;

    if (tool === "eraser") {
      eraseAt(e.clientX, e.clientY);
    } else if (active) {
      const p = active.points.at(-1);
      const d = dist(p.x, p.y, e.clientX, e.clientY);
      if (d > 3) {
        const now = performance.now(), dt = now - p.t, v = d / max(dt, 1);
        const w = lerp(p.w, constrain(map(v, 0, 1.6, 1.7, 0.55), 0.55, 1.7), 0.35);
        active.points.push({ x: e.clientX, y: e.clientY, t: now, w, dt });
      }
    }
  }, { passive: true });

  const end = e => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (active) {
      const s = active; active = null;
      if (s.points.length < 2) { strokes.pop(); updateLabels(); return; }
      startSwarm(s);
      note = null; noteStats = null;
      updateLabels();
    }
  };

  window.addEventListener("pointerup", end, { passive: true });
  window.addEventListener("pointercancel", end, { passive: true });

  window.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") wind.x -= 4;
    if (e.key === "ArrowRight") wind.x += 4;
    if (e.key === "ArrowUp") wind.y -= 4;
    if (e.key === "ArrowDown") wind.y += 4;
  });

  if ($("windBtn")) {
    $("windBtn").addEventListener("click", () => {
      wind.x = random(-6, 6);
      wind.y = random(-6, 6);
    });
  }

  const pick = (attr, apply) => document.querySelectorAll(`[${attr}]`).forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(`[${attr}]`).forEach(x => x.classList.remove("active"));
    b.classList.add("active"); apply(b);
  }));

  pick("data-tool", b => tool = b.dataset.tool);
  pick("data-color", b => ink = b.dataset.color);
  pick("data-mode", b => aiMode = b.dataset.mode);

  if ($("strokeSize")) {
    $("strokeSize").addEventListener("input", e => brushSize = Number(e.target.value));
  }

  if ($("customColor")) {
    $("customColor").addEventListener("input", e => {
      document.querySelectorAll("[data-color]").forEach(x => x.classList.remove("active"));
      ink = e.target.value;
    });
  }

  if ($("reset")) $("reset").addEventListener("click", clearWork);
  if ($("clearMobile")) $("clearMobile").addEventListener("click", clearWork);
  if ($("undoMobile")) $("undoMobile").addEventListener("click", undoStroke);
}

function undoStroke() {
  if (!strokes.length) return;
  strokes.pop();
  if (swarms.length) swarms.pop();
  redrawGhost();
  note = null; noteStats = null;
  if (!strokes.length) {
    let hint = $("drawHint");
    if (hint) hint.classList.remove("hidden");
  }
  updateLabels();
}

function clearWork() {
  strokes.length = swarms.length = particles.length = 0;
  note = null; noteStats = null;
  redrawGhost();
  let hint = $("drawHint");
  if (hint) hint.classList.remove("hidden");
  updateLabels();
}

function updateLabels() {
  const n = strokes.length;
  if ($("reflectionNumber")) $("reflectionNumber").textContent = noteStats ? Math.round(noteStats.fid) + "%" : (n / 10).toFixed(1);
  if ($("reflectionText")) $("reflectionText").textContent = note || messages[min(floor(n / 3), messages.length - 1)];
}