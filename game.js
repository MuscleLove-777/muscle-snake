/* ========================================
   筋肉スネーク / Muscle Snake
   MuscleLove - Pure JS Canvas Game
   ======================================== */

(function () {
  'use strict';

  // ===== CONSTANTS =====
  const IMG_COUNT = 10;
  const DESKTOP_GRID = 20;
  const MOBILE_GRID = 15;
  const BASE_INTERVAL = 150;       // ms per tick at start
  const MIN_INTERVAL = 60;         // fastest speed
  const SPEED_STEP = 3;            // ms faster per body segment
  const STAR_CHANCE = 0.08;        // 8% chance food is a star
  const STAR_SCORE = 50;
  const FOOD_SCORE = 10;

  // ===== DOM =====
  const $ = (s) => document.querySelector(s);
  const screens = {
    title: $('#title-screen'),
    game: $('#game-screen'),
    result: $('#result-screen'),
  };
  const canvas = $('#game-canvas');
  const ctx = canvas.getContext('2d');
  const hudScore = $('#hud-score');
  const hudLength = $('#hud-length');
  const hudTime = $('#hud-time');
  const countdownOverlay = $('#countdown-overlay');
  const countdownText = $('#countdown-text');
  const pauseOverlay = $('#pause-overlay');

  // ===== STATE =====
  let gridSize, cellSize, canvasSize;
  let snake, direction, nextDirection, food, score, alive, paused;
  let gameInterval, timerInterval, startTime, elapsedSec;
  let imageIndex;  // which image to assign next body segment

  // ===== IMAGES =====
  const images = [];
  let imagesLoaded = 0;
  for (let i = 1; i <= IMG_COUNT; i++) {
    const img = new Image();
    img.src = `images/img${i}.png`;
    img.onload = () => { imagesLoaded++; };
    images.push(img);
  }

  // ===== AUDIO =====
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
  }

  function playTone(freq, dur, type = 'square', vol = 0.15) {
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (_) { /* ignore audio errors */ }
  }

  function sfxEat() { playTone(600, 0.12, 'square', 0.12); playTone(800, 0.1, 'square', 0.1); }
  function sfxBonus() { playTone(800, 0.1, 'sine', 0.15); setTimeout(() => playTone(1200, 0.15, 'sine', 0.15), 80); }
  function sfxCrash() { playTone(120, 0.4, 'sawtooth', 0.2); }

  // ===== HELPERS =====
  function isMobile() { return window.innerWidth <= 600; }

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function randomCell() {
    return { x: Math.floor(Math.random() * gridSize), y: Math.floor(Math.random() * gridSize) };
  }

  function cellOccupied(c) {
    return snake.some((s) => s.x === c.x && s.y === c.y);
  }

  function spawnFood() {
    let pos;
    do { pos = randomCell(); } while (cellOccupied(pos));
    const isStar = Math.random() < STAR_CHANCE;
    food = { x: pos.x, y: pos.y, type: isStar ? 'star' : 'protein' };
  }

  // ===== SIZING =====
  function setupCanvas() {
    gridSize = isMobile() ? MOBILE_GRID : DESKTOP_GRID;
    const container = $('#canvas-container');
    const maxW = container.clientWidth - 16;
    const maxH = container.clientHeight - 16;
    const maxDim = Math.min(maxW, maxH, 600);
    cellSize = Math.floor(maxDim / gridSize);
    canvasSize = cellSize * gridSize;
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    canvas.style.width = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';
  }

  // ===== DRAWING =====
  function draw() {
    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Grid lines
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridSize; i++) {
      const p = i * cellSize;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, canvasSize); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(canvasSize, p); ctx.stroke();
    }

    // Food
    const fx = food.x * cellSize;
    const fy = food.y * cellSize;
    ctx.font = `${cellSize * 0.8}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const emoji = food.type === 'star' ? '⭐' : '🥤';
    // Glow
    ctx.shadowColor = food.type === 'star' ? '#ffd700' : '#00e5ff';
    ctx.shadowBlur = 12;
    ctx.fillText(emoji, fx + cellSize / 2, fy + cellSize / 2);
    ctx.shadowBlur = 0;

    // Snake body (draw tail-to-head so head is on top)
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const sx = seg.x * cellSize;
      const sy = seg.y * cellSize;

      if (i === 0) {
        // Head: 💪 emoji
        ctx.font = `${cellSize * 0.85}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 10;
        ctx.fillText('💪', sx + cellSize / 2, sy + cellSize / 2);
        ctx.shadowBlur = 0;
      } else {
        // Body: muscle image thumbnail
        const imgIdx = seg.imgIndex % IMG_COUNT;
        const img = images[imgIdx];
        if (img && img.complete && img.naturalWidth > 0) {
          // Rounded rect clip
          const pad = 1;
          const r = 3;
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(sx + pad, sy + pad, cellSize - pad * 2, cellSize - pad * 2, r);
          ctx.clip();
          ctx.drawImage(img, sx + pad, sy + pad, cellSize - pad * 2, cellSize - pad * 2);
          ctx.restore();
          // Border glow
          ctx.strokeStyle = 'rgba(255, 20, 147, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(sx + pad, sy + pad, cellSize - pad * 2, cellSize - pad * 2, r);
          ctx.stroke();
        } else {
          // Fallback: colored square
          ctx.fillStyle = `hsl(${(i * 30) % 360}, 80%, 55%)`;
          ctx.fillRect(sx + 1, sy + 1, cellSize - 2, cellSize - 2);
        }
      }
    }
  }

  // ===== GAME LOGIC =====
  function tick() {
    if (!alive || paused) return;

    direction = nextDirection;

    // Move head
    const head = { ...snake[0] };
    switch (direction) {
      case 'up': head.y--; break;
      case 'down': head.y++; break;
      case 'left': head.x--; break;
      case 'right': head.x++; break;
    }

    // Wall collision
    if (head.x < 0 || head.x >= gridSize || head.y < 0 || head.y >= gridSize) {
      die();
      return;
    }

    // Self collision
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      die();
      return;
    }

    head.imgIndex = 0; // head doesn't show image
    snake.unshift(head);

    // Check food
    if (head.x === food.x && head.y === food.y) {
      if (food.type === 'star') {
        score += STAR_SCORE;
        sfxBonus();
      } else {
        score += FOOD_SCORE;
        sfxEat();
      }
      // The new tail segment keeps its position (don't pop) and gets an image
      snake[snake.length - 1].imgIndex = imageIndex;
      imageIndex = (imageIndex + 1) % IMG_COUNT;

      spawnFood();
      updateSpeed();
    } else {
      snake.pop(); // remove tail
    }

    updateHUD();
    draw();
  }

  function updateSpeed() {
    const bodyLen = snake.length - 1;
    const interval = Math.max(MIN_INTERVAL, BASE_INTERVAL - bodyLen * SPEED_STEP);
    clearInterval(gameInterval);
    gameInterval = setInterval(tick, interval);
  }

  function updateHUD() {
    hudScore.textContent = score;
    hudLength.textContent = snake.length;
  }

  function die() {
    alive = false;
    clearInterval(gameInterval);
    clearInterval(timerInterval);
    sfxCrash();

    // Flash canvas red
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    setTimeout(showResult, 600);
  }

  function showResult() {
    const randImg = Math.floor(Math.random() * IMG_COUNT) + 1;
    $('#result-image').src = `images/img${randImg}.png`;
    $('#result-score').textContent = score;
    $('#result-length').textContent = snake.length;
    $('#result-time').textContent = formatTime(elapsedSec);
    showScreen('result');
  }

  // ===== COUNTDOWN & START =====
  function startCountdown() {
    showScreen('game');
    setupCanvas();
    initGame();
    draw();

    countdownOverlay.classList.remove('hidden');
    let count = 3;
    countdownText.textContent = count;

    const cdi = setInterval(() => {
      count--;
      if (count > 0) {
        countdownText.textContent = count;
        // Re-trigger animation
        countdownText.style.animation = 'none';
        void countdownText.offsetWidth;
        countdownText.style.animation = '';
      } else {
        countdownText.textContent = 'GO!';
        setTimeout(() => {
          countdownOverlay.classList.add('hidden');
          startGame();
        }, 400);
        clearInterval(cdi);
      }
    }, 700);
  }

  function initGame() {
    const mid = Math.floor(gridSize / 2);
    snake = [{ x: mid, y: mid, imgIndex: 0 }];
    direction = 'right';
    nextDirection = 'right';
    score = 0;
    alive = true;
    paused = false;
    elapsedSec = 0;
    imageIndex = 0;
    spawnFood();
    updateHUD();
    hudTime.textContent = '0:00';
  }

  function startGame() {
    ensureAudio();
    alive = true;
    startTime = Date.now();
    gameInterval = setInterval(tick, BASE_INTERVAL);
    timerInterval = setInterval(() => {
      if (!paused) {
        elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        hudTime.textContent = formatTime(elapsedSec);
      }
    }, 500);
  }

  function togglePause() {
    if (!alive) return;
    paused = !paused;
    pauseOverlay.classList.toggle('hidden', !paused);
  }

  // ===== INPUT =====
  const DIR_MAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right',
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (screens.game.classList.contains('active') && alive) {
        e.preventDefault();
        togglePause();
      }
      return;
    }
    const dir = DIR_MAP[e.key];
    if (dir && alive && !paused) {
      e.preventDefault();
      if (dir !== OPPOSITE[direction]) {
        nextDirection = dir;
      }
    }
  });

  // Mobile d-pad buttons
  document.querySelectorAll('.ctrl-btn').forEach((btn) => {
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const dir = btn.dataset.dir;
      if (dir && alive && !paused && dir !== OPPOSITE[direction]) {
        nextDirection = dir;
      }
    });
    btn.addEventListener('click', (e) => {
      const dir = btn.dataset.dir;
      if (dir && alive && !paused && dir !== OPPOSITE[direction]) {
        nextDirection = dir;
      }
    });
  });

  // Swipe
  let touchStartX, touchStartY;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (!touchStartX) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < 20) return; // too small

    let dir;
    if (absDx > absDy) {
      dir = dx > 0 ? 'right' : 'left';
    } else {
      dir = dy > 0 ? 'down' : 'up';
    }
    if (alive && !paused && dir !== OPPOSITE[direction]) {
      nextDirection = dir;
    }
    touchStartX = null;
  }, { passive: true });

  // ===== BUTTONS =====
  $('#start-btn').addEventListener('click', () => {
    ensureAudio();
    startCountdown();
  });
  $('#retry-btn').addEventListener('click', () => startCountdown());
  $('#resume-btn').addEventListener('click', () => togglePause());

  $('#share-btn').addEventListener('click', () => {
    const text = `【筋肉スネーク】長さ${snake.length}体！スコア${score}💪 #MuscleLove #筋肉スネーク`;
    const url = 'https://www.patreon.com/cw/MuscleLove';
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
  });

  // ===== RESIZE =====
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (screens.game.classList.contains('active') && alive) {
        setupCanvas();
        draw();
      }
    }, 200);
  });

  // ===== INIT =====
  showScreen('title');

})();
