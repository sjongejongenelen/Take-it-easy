(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("startOverlay");
  const logoLockup = document.getElementById("logoLockup");
  const logoLine = document.getElementById("logoLine");
  const logoMain = document.getElementById("logoMain");
  const startButton = document.getElementById("startButton");
  const scoreClock = document.getElementById("scoreClock");
  const scoreValue = document.getElementById("scoreValue");
  const overlayScore = document.getElementById("overlayScore");
  const scoreForm = document.getElementById("scoreForm");
  const playerName = document.getElementById("playerName");
  const saveScoreButton = document.getElementById("saveScoreButton");
  const rankingList = document.getElementById("rankingList");
  const music = document.getElementById("music");

  const W = canvas.width;
  const H = canvas.height;
  const ROWS = 12;
  const COLS = 20;
  const CELL_W = W / COLS;
  const CELL_H = H / ROWS;
  const START_COL = Math.floor(COLS / 2);
  const FINISH_ROW = 1;
  const WALKER_SPEED_BOOST = 2.05;
  const SCORES_KEY = "sisi-easy-crossing-slowscores";
  const SCORE_ENDPOINT = "/.netlify/functions/scores";
  const DEFAULT_SCORES = [{ name: "Easy Stef", score: 336.4 }];
  const PLAYER_DRAW_W = 92;
  const PLAYER_DRAW_H = 116;
  const PLAYER_DRAW_Y_OFFSET = 92;
  const PLAYER_FEET_Y_OFFSET = PLAYER_DRAW_H - PLAYER_DRAW_Y_OFFSET - 2;
  const ALPHA_HIT_THRESHOLD = 48;

  const sprite = new Image();
  sprite.src = "assets/mascot-sprite.png";
  const background = new Image();
  background.src = "assets/sisi-background-pixel.png";

  const lanes = [
    { row: 2, dir: 1, speed: 8.2, count: 3, offset: 80 },
    { row: 3, dir: -1, speed: 5.8, count: 5, offset: 220 },
    { row: 4, dir: 1, speed: 7.4, count: 4, offset: 390 },
    { row: 5, dir: -1, speed: 6.4, count: 5, offset: 20 },
    { row: 7, dir: 1, speed: 5.8, count: 5, offset: 160 },
    { row: 8, dir: -1, speed: 6.4, count: 4, offset: 520 },
    { row: 9, dir: 1, speed: 8.2, count: 3, offset: 710 },
    { row: 10, dir: -1, speed: 7.4, count: 4, offset: 310 },
  ];

  const state = {
    running: false,
    finished: false,
    scoreTime: 0,
    finishedScore: 0,
    scoreSaved: false,
    walkers: [],
    lastTime: 0,
    flashText: "",
    flashTimer: 0,
    shake: 0,
    audioReady: false,
    muted: false,
    audioContext: null,
    spriteMask: null,
    rankingRequest: 0,
  };

  const player = {
    col: START_COL,
    row: 11,
    x: 0,
    y: 0,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    moveT: 0,
    moveDuration: 5,
    moving: false,
    invulnerable: 0,
  };

  function cellCenter(col, row) {
    return {
      x: col * CELL_W + CELL_W / 2,
      y: row * CELL_H + CELL_H / 2,
    };
  }

  function resetPlayer(row = 11, col = START_COL, invulnerable = 0.25) {
    const pos = cellCenter(col, row);
    player.col = col;
    player.row = row;
    player.x = pos.x;
    player.y = pos.y;
    player.fromX = pos.x;
    player.fromY = pos.y;
    player.toX = pos.x;
    player.toY = pos.y;
    player.moveT = 0;
    player.moving = false;
    player.invulnerable = invulnerable;
  }

  function speedFactor() {
    return 1;
  }

  function currentMoveDuration() {
    return 5;
  }

  function musicRate() {
    return 0.72;
  }

  function makeWalkers() {
    state.walkers = [];
    lanes.forEach((lane, laneIndex) => {
      const spacing = W / lane.count;
      for (let i = 0; i < lane.count; i += 1) {
        state.walkers.push({
          row: lane.row,
          dir: lane.dir,
          speed: lane.speed,
          x: (lane.offset + i * spacing) % W,
          kind: (laneIndex + i) % 2 === 0 ? "oma" : "opa",
          tint: laneIndex % 3,
          phase: i * 0.35 + laneIndex * 0.2,
        });
      }
    });
  }

  function isRoadRow(row) {
    return (row >= 2 && row <= 5) || (row >= 7 && row <= 10);
  }

  function currentPlayerRow() {
    return Math.max(0, Math.min(ROWS - 1, Math.floor((player.y + PLAYER_FEET_Y_OFFSET) / CELL_H)));
  }

  function isPlayerOnRoad() {
    return isRoadRow(currentPlayerRow());
  }

  function canUseGlobalScores() {
    return window.location.protocol !== "file:";
  }

  function formatTime(seconds) {
    const totalTenths = Math.floor(seconds * 10);
    const minutes = Math.floor(totalTenths / 600);
    const secs = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
  }

  function updateScoreClock() {
    scoreValue.textContent = formatTime(state.scoreTime);
    scoreClock.classList.toggle("is-paused", !state.running || state.finished || !isPlayerOnRoad());
  }

  function cleanScores(scores) {
    if (!Array.isArray(scores)) return [];
    const bestByName = new Map();
    scores
      .filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(entry.score))
      .forEach((entry) => {
        const score = {
        name: entry.name.trim().replace(/\s+/g, " ").slice(0, 14) || "Easy speler",
        score: Math.max(0, entry.score),
        };
        const existing = bestByName.get(score.name);
        if (!existing || score.score > existing.score) bestByName.set(score.name, score);
      });

    return Array.from(bestByName.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  function readLocalScores() {
    try {
      const stored = JSON.parse(localStorage.getItem(SCORES_KEY) || "[]");
      return cleanScores([...DEFAULT_SCORES, ...stored]);
    } catch {
      return cleanScores(DEFAULT_SCORES);
    }
  }

  function writeLocalScores(scores) {
    localStorage.setItem(SCORES_KEY, JSON.stringify(cleanScores(scores)));
  }

  async function fetchGlobalScores() {
    if (!canUseGlobalScores()) return null;

    try {
      const response = await fetch(SCORE_ENDPOINT, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return cleanScores(payload.scores);
    } catch {
      return null;
    }
  }

  async function submitGlobalScore(entry) {
    if (!canUseGlobalScores()) return null;

    try {
      const response = await fetch(SCORE_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(entry),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return cleanScores(payload.scores);
    } catch {
      return null;
    }
  }

  async function getScores() {
    const globalScores = await fetchGlobalScores();
    return globalScores || readLocalScores();
  }

  function drawRanking(scores) {
    rankingList.innerHTML = "";

    if (scores.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-ranking";
      empty.textContent = "Nog niemand nam genoeg tijd.";
      rankingList.append(empty);
      return;
    }

    scores.forEach((entry) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const score = document.createElement("strong");
      name.textContent = entry.name;
      score.textContent = formatTime(entry.score);
      item.append(name, score);
      rankingList.append(item);
    });
  }

  async function renderRanking(scoresOverride = null) {
    const request = ++state.rankingRequest;
    const scores = scoresOverride || (await getScores());
    if (request !== state.rankingRequest && !scoresOverride) return;
    drawRanking(scores);
  }

  function showScoreForm(visible) {
    scoreForm.classList.toggle("is-visible", visible);
  }

  function setOverlayCopy(finished) {
    overlay.classList.toggle("is-finished", finished);
    logoLockup.classList.toggle("is-easy", finished);
    logoLine.textContent = finished ? "SLOWSCORE!" : "TAKE IT EASY,";
    logoMain.textContent = finished ? "EASY!" : "TAKE A SISI";
  }

  function resetRound() {
    state.finished = false;
    state.running = false;
    state.scoreTime = 0;
    state.finishedScore = 0;
    state.scoreSaved = false;
    state.flashText = "";
    state.flashTimer = 0;
    setOverlayCopy(false);
    overlayScore.textContent = "";
    startButton.textContent = "Start easy";
    saveScoreButton.disabled = false;
    playerName.value = "";
    showScoreForm(false);
    resetPlayer(11, START_COL, 0);
    makeWalkers();
    void renderRanking();
    updateScoreClock();
  }

  function ensureAudioContext() {
    if (!state.audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        state.audioContext = new AudioCtor();
      }
    }
    if (state.audioContext && state.audioContext.state === "suspended") {
      state.audioContext.resume();
    }
  }

  function blip(freq, duration = 0.07, gain = 0.035) {
    if (!state.audioContext || state.muted) return;
    const audio = state.audioContext;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, audio.currentTime);
    amp.gain.setValueAtTime(gain, audio.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    osc.connect(amp);
    amp.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  }

  async function startMusic() {
    music.volume = 0.42;
    music.playbackRate = musicRate();
    try {
      await music.play();
      state.audioReady = true;
    } catch {
      state.audioReady = false;
    }
  }

  function startGame() {
    if (state.finished) {
      resetRound();
    }
    state.running = true;
    overlay.classList.add("is-hidden");
    ensureAudioContext();
    startMusic();
  }

  function toggleMusic() {
    ensureAudioContext();
    state.muted = !state.muted;
    music.muted = state.muted;
    if (!state.muted && music.paused) {
      startMusic();
    }
  }

  function movePlayer(dx, dy) {
    if (state.finished) return;
    if (!state.running) {
      startGame();
    }
    if (player.moving || player.invulnerable > 0.25) return;
    const nextCol = Math.max(0, Math.min(COLS - 1, player.col + dx));
    const nextRow = Math.max(0, Math.min(ROWS - 1, player.row + dy));
    if (nextCol === player.col && nextRow === player.row) return;

    const next = cellCenter(nextCol, nextRow);
    player.fromX = player.x;
    player.fromY = player.y;
    player.toX = next.x;
    player.toY = next.y;
    player.col = nextCol;
    player.row = nextRow;
    player.moveT = 0;
    player.moveDuration = currentMoveDuration();
    player.moving = true;
    blip(150 + (11 - nextRow) * 14, 0.09, 0.021);
  }

  function playerDrawRect() {
    return {
      x: Math.round(player.x - PLAYER_DRAW_W / 2),
      y: Math.round(player.y - PLAYER_DRAW_Y_OFFSET),
      w: PLAYER_DRAW_W,
      h: PLAYER_DRAW_H,
    };
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function ensureSpriteMask() {
    if (state.spriteMask) return state.spriteMask;
    if (!sprite.complete || sprite.naturalWidth <= 0 || sprite.naturalHeight <= 0) return null;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = sprite.naturalWidth;
    maskCanvas.height = sprite.naturalHeight;
    const maskCtx = maskCanvas.getContext("2d");
    maskCtx.imageSmoothingEnabled = false;
    maskCtx.drawImage(sprite, 0, 0);

    try {
      const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const solid = buildSolidSpriteMask(imageData.data, maskCanvas.width, maskCanvas.height);
      state.spriteMask = {
        width: maskCanvas.width,
        height: maskCanvas.height,
        solid,
      };
      return state.spriteMask;
    } catch {
      return null;
    }
  }

  function buildSolidSpriteMask(data, width, height) {
    const solid = new Uint8Array(width * height);
    const seen = new Uint8Array(width * height);
    let bestComponent = [];

    for (let i = 0; i < solid.length; i += 1) {
      solid[i] = data[i * 4 + 3] > ALPHA_HIT_THRESHOLD ? 1 : 0;
    }

    for (let i = 0; i < solid.length; i += 1) {
      if (!solid[i] || seen[i]) continue;

      const stack = [i];
      const component = [];
      seen[i] = 1;

      while (stack.length) {
        const current = stack.pop();
        component.push(current);
        const x = current % width;
        const y = Math.floor(current / width);
        const neighbors = [
          x > 0 ? current - 1 : -1,
          x < width - 1 ? current + 1 : -1,
          y > 0 ? current - width : -1,
          y < height - 1 ? current + width : -1,
        ];

        neighbors.forEach((next) => {
          if (next >= 0 && solid[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        });
      }

      if (component.length > bestComponent.length) bestComponent = component;
    }

    const cleaned = new Uint8Array(width * height);
    bestComponent.forEach((index) => {
      cleaned[index] = 1;
    });
    return cleaned;
  }

  function spriteHasPixelAt(mask, playerRect, x, y) {
    const sourceX = Math.floor(((x + 0.5 - playerRect.x) / playerRect.w) * mask.width);
    const sourceY = Math.floor(((y + 0.5 - playerRect.y) / playerRect.h) * mask.height);
    if (sourceX < 0 || sourceX >= mask.width || sourceY < 0 || sourceY >= mask.height) return false;
    return mask.solid[sourceY * mask.width + sourceX] === 1;
  }

  function spriteTouchesRect(mask, playerRect, rectBox) {
    const left = Math.max(Math.ceil(playerRect.x), Math.ceil(rectBox.x));
    const right = Math.min(Math.floor(playerRect.x + playerRect.w), Math.floor(rectBox.x + rectBox.w));
    const top = Math.max(Math.ceil(playerRect.y), Math.ceil(rectBox.y));
    const bottom = Math.min(Math.floor(playerRect.y + playerRect.h), Math.floor(rectBox.y + rectBox.h));

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (spriteHasPixelAt(mask, playerRect, x, y)) return true;
      }
    }
    return false;
  }

  function walkerLocalRects(walker) {
    const step = Math.sin(walker.phase * Math.PI * 2) > 0 ? 2 : -2;
    return [
      { x: 0, y: -3, w: 32, h: 4 },
      { x: 28, y: -3, w: 4, h: 31 },
      { x: 4, y: -3, w: 4, h: 31 },
      { x: 4, y: 18, w: 28, h: 4 },
      { x: 2, y: 26, w: 8, h: 8 },
      { x: 26, y: 26, w: 8, h: 8 },
      { x: -26, y: -14, w: 22, h: 30 },
      { x: -23, y: 14 + step, w: 7, h: 17 },
      { x: -10, y: 14 - step, w: 7, h: 17 },
      { x: -27, y: -31, w: 22, h: 20 },
      { x: -27, y: -35, w: 22, h: 8 },
      { x: -5, y: -8, w: 13, h: 5 },
    ];
  }

  function walkerCollisionRects(walker) {
    const centerY = walker.row * CELL_H + CELL_H / 2;
    return walkerLocalRects(walker).map((box) => ({
      x: walker.dir > 0 ? walker.x + box.x : walker.x - box.x - box.w,
      y: centerY + box.y,
      w: box.w,
      h: box.h,
    }));
  }

  function playerTouchesWalker(walker) {
    const mask = ensureSpriteMask();
    if (!mask) return false;

    const playerRect = playerDrawRect();
    return walkerCollisionRects(walker).some(
      (box) => overlaps(playerRect, box) && spriteTouchesRect(mask, playerRect, box),
    );
  }

  function handleBump() {
    state.shake = 0.22;
    state.scoreTime = 0;
    state.flashText = "Geraakt. Tijd weer op nul.";
    state.flashTimer = 2.2;
    resetPlayer(11, START_COL, 1.25);
    updateScoreClock();
    blip(82, 0.18, 0.05);
  }

  function finishCrossing() {
    state.finished = true;
    state.running = false;
    state.finishedScore = state.scoreTime;
    state.scoreSaved = false;
    setOverlayCopy(true);
    overlayScore.textContent = `Slowscore: ${formatTime(state.finishedScore)}`;
    startButton.textContent = "Opnieuw. Ik kan nog easier";
    saveScoreButton.disabled = false;
    showScoreForm(true);
    overlay.classList.remove("is-hidden");
    updateScoreClock();
    blip(420, 0.08, 0.04);
    window.setTimeout(() => blip(520, 0.12, 0.04), 110);
    window.setTimeout(() => playerName.focus(), 80);
  }

  async function saveScore(event) {
    event.preventDefault();
    if (!state.finished || state.scoreSaved || state.finishedScore <= 0) return;

    const name = playerName.value.trim().replace(/\s+/g, " ").slice(0, 14) || "Easy speler";
    const entry = { name, score: state.finishedScore };
    saveScoreButton.disabled = true;

    const globalScores = await submitGlobalScore(entry);
    if (globalScores) {
      drawRanking(globalScores);
    } else {
      const scores = readLocalScores();
      scores.push(entry);
      writeLocalScores(scores);
      drawRanking(cleanScores(scores));
    }

    state.scoreSaved = true;
    playerName.value = name;
    overlayScore.textContent = `Slowscore bewaard: ${formatTime(state.finishedScore)}`;
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function update(dt) {
    if (state.flashTimer > 0) state.flashTimer -= dt;
    if (state.shake > 0) state.shake -= dt;
    if (player.invulnerable > 0) player.invulnerable -= dt;

    if (!state.running) return;

    if (isPlayerOnRoad()) {
      state.scoreTime += dt;
    }
    updateScoreClock();

    const factor = speedFactor();
    state.walkers.forEach((walker) => {
      walker.x += walker.dir * walker.speed * factor * WALKER_SPEED_BOOST * dt;
      walker.phase += dt * 1.1 * factor;
      if (walker.dir > 0 && walker.x > W + 58) walker.x = -58;
      if (walker.dir < 0 && walker.x < -58) walker.x = W + 58;
    });

    if (player.moving) {
      player.moveT += dt / player.moveDuration;
      const t = Math.min(1, player.moveT);
      const k = ease(t);
      player.x = player.fromX + (player.toX - player.fromX) * k;
      player.y = player.fromY + (player.toY - player.fromY) * k;
      if (t >= 1) {
        player.x = player.toX;
        player.y = player.toY;
        player.moving = false;
      }
    }

    if (player.row <= FINISH_ROW && !player.moving) {
      finishCrossing();
      return;
    }

    const collisionRow = currentPlayerRow();
    const sameRowHit = state.walkers.some((walker) => walker.row === collisionRow && playerTouchesWalker(walker));
    if (isRoadRow(collisionRow) && player.invulnerable <= 0 && sameRowHit) {
      handleBump();
    }
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawCan(x, y, color) {
    rect(x, y + 8, 34, 42, color);
    rect(x + 3, y + 4, 28, 6, "#d8d8d8");
    rect(x + 2, y + 49, 30, 5, "#c3c3c3");
    rect(x + 8, y + 20, 18, 14, "#064dd6");
    rect(x + 11, y + 24, 12, 4, "#ffffff");
  }

  function drawTitleBanner() {
    const bannerW = Math.min(720, W - 36);
    const x = (W - bannerW) / 2;
    rect(x, 8, bannerW, 48, "rgba(27, 23, 51, 0.84)");
    rect(x + 5, 13, bannerW - 10, 38, "rgba(255, 103, 19, 0.88)");
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "900 30px Arial Black, Impact, sans-serif";
    ctx.fillText("Take it Easy, Take a Sisi.", W / 2, 40);
  }

  function drawWorld() {
    if (background.complete && background.naturalWidth > 0) {
      ctx.drawImage(background, 0, 0, W, H);
    } else {
      rect(0, 0, W, H, "#ff6713");
    }

    for (let row = 0; row < ROWS; row += 1) {
      const y = row * CELL_H;
      if (row === 0) {
        rect(0, y, W, CELL_H, "rgba(6, 77, 214, 0.66)");
        for (let x = 0; x < W; x += 64) {
          rect(x, y, 32, 8, "#ffffff");
          rect(x + 32, y + CELL_H - 8, 32, 8, "#ffffff");
        }
        drawTitleBanner();
      } else if (row === 1 || row === 6 || row === 11) {
        const fill = row === 6 ? "rgba(255, 210, 27, 0.78)" : "rgba(83, 204, 102, 0.68)";
        rect(0, y, W, CELL_H, fill);
        for (let x = -24; x < W; x += 92) {
          rect(x, y + 10, 48, 12, row === 6 ? "#ff6713" : "#2e9d52");
          rect(x + 18, y + 36, 54, 10, row === 6 ? "#ffffff" : "#74e07d");
        }
        if (row === 6) {
          drawCan(28, y + 4, "#ff43a4");
          drawCan(W - 62, y + 4, "#ff8a18");
        }
      } else {
        rect(0, y, W, CELL_H, "rgba(70, 73, 88, 0.84)");
        rect(0, y, W, 4, "#3e4150");
        rect(0, y + CELL_H - 4, W, 4, "#777b8a");
        for (let x = 18; x < W; x += 70) {
          rect(x, y + 30, 36, 4, "#fff5ca");
        }
      }
    }

    for (let col = 0; col < COLS; col += 1) {
      if (col % 2 === 0) {
        rect(col * CELL_W, 11 * CELL_H + CELL_H - 10, CELL_W, 10, "#ffd21b");
      }
    }
  }

  function drawWalker(walker) {
    const x = Math.round(walker.x);
    const y = walker.row * CELL_H + CELL_H / 2;
    const dir = walker.dir;
    const coat = walker.tint === 0 ? "#bde1ff" : walker.tint === 1 ? "#f0b1c7" : "#d8c3ff";
    const hair = walker.kind === "oma" ? "#f5f0dc" : "#cfd5dc";
    const step = Math.sin(walker.phase * Math.PI * 2) > 0 ? 2 : -2;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    rect(-34, 22, 72, 8, "rgba(0, 0, 0, 0.18)");

    rect(0, -3, 32, 4, "#dce6ef");
    rect(28, -3, 4, 31, "#dce6ef");
    rect(4, -3, 4, 31, "#dce6ef");
    rect(4, 18, 28, 4, "#dce6ef");
    rect(2, 26, 8, 8, "#1b1733");
    rect(26, 26, 8, 8, "#1b1733");

    rect(-26, -14, 22, 30, coat);
    rect(-23, 14 + step, 7, 17, "#57442f");
    rect(-10, 14 - step, 7, 17, "#57442f");
    rect(-27, -31, 22, 20, "#f2c18f");
    rect(-27, -35, 22, 8, hair);
    rect(-11, -23, 4, 4, "#1b1733");
    rect(-19, -21, 9, 3, "#c77858");
    rect(-5, -8, 13, 5, "#f2c18f");
    ctx.restore();
  }

  function drawPlayer() {
    const x = Math.round(player.x - PLAYER_DRAW_W / 2);
    const y = Math.round(player.y - PLAYER_DRAW_Y_OFFSET);
    const blink = player.invulnerable > 0 && Math.floor(player.invulnerable * 12) % 2 === 0;

    if (!blink && sprite.complete) {
      ctx.drawImage(sprite, x, y, PLAYER_DRAW_W, PLAYER_DRAW_H);
    }
  }

  function drawFlash() {
    if (state.flashTimer <= 0 || !state.flashText) return;
    const w = 500;
    const x = (W - w) / 2;
    const y = H / 2 - 32;
    rect(x, y, w, 64, "rgba(27, 23, 51, 0.86)");
    rect(x + 5, y + 5, w - 10, 54, "rgba(255, 210, 27, 0.92)");
    ctx.fillStyle = "#1b1733";
    ctx.textAlign = "center";
    ctx.font = "900 25px Arial Black, Impact, sans-serif";
    ctx.fillText(state.flashText, W / 2, y + 40);
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) {
      const amount = state.shake * 12;
      ctx.translate(Math.sin(performance.now() / 18) * amount, Math.cos(performance.now() / 22) * amount);
    }

    ctx.imageSmoothingEnabled = false;
    drawWorld();
    state.walkers.forEach(drawWalker);
    drawPlayer();
    drawFlash();
    ctx.restore();

    rect(0, 0, W, 4, "#1b1733");
    rect(0, H - 4, W, 4, "#1b1733");
    rect(0, 0, 4, H, "#1b1733");
    rect(W - 4, 0, 4, H, "#1b1733");
  }

  function frame(time) {
    const seconds = time / 1000;
    const dt = state.lastTime ? Math.min(0.05, seconds - state.lastTime) : 0;
    state.lastTime = seconds;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function onKey(event) {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;
    if (isTyping) return;

    const key = event.key.toLowerCase();
    if (key === "arrowup" || key === "w") {
      event.preventDefault();
      movePlayer(0, -1);
    } else if (key === "arrowleft" || key === "a") {
      event.preventDefault();
      movePlayer(-1, 0);
    } else if (key === "arrowright" || key === "d") {
      event.preventDefault();
      movePlayer(1, 0);
    } else if (key === "m") {
      toggleMusic();
    }
  }

  function wireControls() {
    startButton.addEventListener("click", startGame);
    scoreForm.addEventListener("submit", saveScore);
    window.addEventListener("keydown", onKey);
    document.querySelectorAll("[data-move]").forEach((button) => {
      button.addEventListener("click", () => {
        const move = button.dataset.move;
        if (move === "up") movePlayer(0, -1);
        if (move === "left") movePlayer(-1, 0);
        if (move === "right") movePlayer(1, 0);
      });
    });
  }

  resetRound();
  wireControls();
  void renderRanking();
  requestAnimationFrame(frame);
})();
