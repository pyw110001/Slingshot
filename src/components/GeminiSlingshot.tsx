import {
  Activity,
  Camera,
  Crosshair,
  Hand,
  Play,
  RadioTower,
  RefreshCw,
  Sparkles,
  Zap
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ballImgUrl from '../assets/ball.png';

type CameraState = 'idle' | 'requesting' | 'live' | 'error';
type GestureMode = 'searching' | 'tracking' | 'charging' | 'release';

type Vec2 = {
  x: number;
  y: number;
};

type Bubble = Vec2 & {
  radius: number;
  color: string;
  hit: boolean;
  pulse: number;
};

type Projectile = Vec2 & {
  vx: number;
  vy: number;
  radius: number;
  color: string;
  active: boolean;
};

type Particle = Vec2 & {
  vx: number;
  vy: number;
  life: number;
  color: string;
};

type GestureSnapshot = {
  mode: GestureMode;
  confidence: number;
  hand: Vec2 | null;
  aim: Vec2;
  charge: number;
  pinchDistance: number;
  seenAt: number;
};

type GameState = {
  width: number;
  height: number;
  dpr: number;
  score: number;
  streak: number;
  charge: number;
  shots: number;
  anchor: Vec2;
  aim: Vec2;
  bubbles: Bubble[];
  projectile: Projectile | null;
  particles: Particle[];
  nextColor: string;
  lastFire: number;
  gameOver: boolean;
};

type HudState = {
  score: number;
  streak: number;
  charge: number;
  shots: number;
  targets: number;
  gestureMode: GestureMode;
  confidence: number;
  gameOver: boolean;
};

const BUBBLE_COLORS = ['#26ecdd', '#ffb536', '#ff5f8f', '#8ea7ff', '#9cff6e'];
const INITIAL_HUD: HudState = {
  score: 0,
  streak: 0,
  charge: 0,
  shots: 0,
  targets: 0,
  gestureMode: 'searching',
  confidence: 0,
  gameOver: false
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Vec2) {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function pickNextColor() {
  return BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
}

function fixedAnchor(width: number, height: number): Vec2 {
  return { x: width * 0.5, y: height * 0.78 };
}

function createGameState(width = 960, height = 640): GameState {
  return {
    width,
    height,
    dpr: 1,
    score: 0,
    streak: 0,
    charge: 0,
    shots: 0,
    anchor: fixedAnchor(width, height),
    aim: { x: 0, y: -1 },
    bubbles: createBubbleField(width, height),
    projectile: null,
    particles: [],
    nextColor: pickNextColor(),
    lastFire: 0,
    gameOver: false
  };
}

function createBubbleField(width: number, height: number): Bubble[] {
  const bubbles: Bubble[] = [];
  const radius = clamp(width * 0.026, 18, 30);
  const columns = Math.max(8, Math.floor(width / (radius * 2.35)));
  const rows = 4;
  const startX = (width - (columns - 1) * radius * 2.1) / 2;
  const startY = height * 0.12;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offset = row % 2 ? radius : 0;
      bubbles.push({
        x: startX + column * radius * 2.1 + offset,
        y: startY + row * radius * 2,
        radius,
        color: BUBBLE_COLORS[(row + column) % BUBBLE_COLORS.length],
        hit: false,
        pulse: Math.random() * Math.PI * 2
      });
    }
  }

  return bubbles;
}

function mapLandmarksToGesture(landmarks: Landmark[], width: number, height: number): GestureSnapshot {
  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const middleMcp = landmarks[9];

  const hand = {
    x: (1 - middleMcp.x) * width,
    y: middleMcp.y * height
  };
  const anchor = fixedAnchor(width, height);
  const pinchPoint = {
    x: (1 - (indexTip.x + thumbTip.x) / 2) * width,
    y: ((indexTip.y + thumbTip.y) / 2) * height
  };
  const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
  const pull = distance(anchor, pinchPoint);
  const charge = clamp((pull - width * 0.06) / (width * 0.24), 0, 1);
  const aim = normalize({ x: anchor.x - pinchPoint.x, y: anchor.y - pinchPoint.y });

  return {
    mode: pinchDistance < 0.052 && charge > 0.18 ? 'charging' : 'tracking',
    confidence: clamp(1 - pinchDistance * 8.5, 0.1, 1),
    hand,
    aim: aim.y > -0.08 ? normalize({ x: aim.x, y: -0.3 }) : aim,
    charge,
    pinchDistance,
    seenAt: performance.now()
  };
}

function burst(game: GameState, x: number, y: number, color: string, count = 16) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.4 + Math.random() * 3.5;
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color
    });
  }
}

function fireProjectile(game: GameState) {
  const now = performance.now();
  if (game.gameOver || game.projectile?.active || game.charge < 0.3 || now - game.lastFire < 480) {
    return;
  }

  const speed = 11 + game.charge * 12;
  game.projectile = {
    x: game.anchor.x,
    y: game.anchor.y,
    vx: game.aim.x * speed,
    vy: game.aim.y * speed,
    radius: clamp(game.width * 0.022, 16, 25),
    color: game.nextColor,
    active: true
  };
  game.nextColor = pickNextColor();
  game.shots += 1;
  game.lastFire = now;
  game.charge = 0;
}

function activeBubbles(game: GameState) {
  return game.bubbles.filter((bubble) => !bubble.hit);
}

function findSameColorCluster(game: GameState, start: Bubble) {
  const cluster: Bubble[] = [];
  const queue: Bubble[] = [start];
  const visited = new Set<Bubble>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    cluster.push(current);

    for (const candidate of activeBubbles(game)) {
      const linkDistance = current.radius + candidate.radius + Math.max(current.radius, candidate.radius) * 0.58;
      if (
        !visited.has(candidate) &&
        candidate.color === start.color &&
        distance(current, candidate) <= linkDistance
      ) {
        queue.push(candidate);
      }
    }
  }

  return cluster;
}

function findAllMatchedClusters(game: GameState) {
  const matched: Bubble[] = [];
  const scanned = new Set<Bubble>();

  for (const bubble of activeBubbles(game)) {
    if (scanned.has(bubble)) {
      continue;
    }

    const cluster = findSameColorCluster(game, bubble);
    cluster.forEach((member) => scanned.add(member));

    if (cluster.length >= 3) {
      matched.push(...cluster);
    }
  }

  return matched;
}

function resolveMatches(game: GameState) {
  const matched = findAllMatchedClusters(game);
  if (matched.length < 3) {
    game.streak = 0;
    return;
  }

  matched.forEach((bubble) => {
    bubble.hit = true;
    burst(game, bubble.x, bubble.y, bubble.color, 18);
  });

  game.bubbles = activeBubbles(game);
  game.streak += 1;
  game.score += matched.length * 120 + game.streak * 60;
}

function attachProjectile(game: GameState, projectile: Projectile, impactBubble?: Bubble) {
  if (game.gameOver) {
    game.projectile = null;
    return;
  }

  const radius = impactBubble?.radius ?? projectile.radius;
  const attachedBubble: Bubble = {
    x: clamp(projectile.x, radius, game.width - radius),
    y: clamp(projectile.y, radius + 6, game.height - radius),
    radius,
    color: projectile.color,
    hit: false,
    pulse: Math.random() * Math.PI * 2
  };

  if (impactBubble) {
    const rawDirection = {
      x: projectile.x - impactBubble.x,
      y: projectile.y - impactBubble.y
    };
    const direction =
      Math.hypot(rawDirection.x, rawDirection.y) > 1
        ? normalize(rawDirection)
        : normalize({ x: -projectile.vx, y: -projectile.vy });
    attachedBubble.x = clamp(impactBubble.x + direction.x * radius * 1.94, radius, game.width - radius);
    attachedBubble.y = clamp(impactBubble.y + direction.y * radius * 1.94, radius + 6, game.height - radius);
  }

  game.bubbles.push(attachedBubble);
  resolveMatches(game);
  game.projectile = null;
}

function updateGameOver(game: GameState) {
  const dangerLine = game.anchor.y - Math.max(118, game.height * 0.16);
  const hasBubbleInDangerZone = activeBubbles(game).some((bubble) => bubble.y + bubble.radius >= dangerLine);
  if (hasBubbleInDangerZone) {
    game.gameOver = true;
    game.projectile = null;
    game.charge = 0;
  }
}

function updateGame(game: GameState, gesture: GestureSnapshot) {
  const staleGesture = performance.now() - gesture.seenAt > 900;
  game.anchor = fixedAnchor(game.width, game.height);

  if (game.gameOver) {
    game.charge = 0;
  } else if (!staleGesture) {
    game.aim = normalize({
      x: lerp(game.aim.x, gesture.aim.x, 0.14),
      y: lerp(game.aim.y, gesture.aim.y, 0.14)
    });
    game.charge = lerp(game.charge, gesture.mode === 'charging' ? gesture.charge : 0, 0.18);
  } else {
    game.charge = lerp(game.charge, 0, 0.12);
  }

  if (!game.gameOver && gesture.mode === 'release') {
    fireProjectile(game);
  }

  if (!game.gameOver && game.projectile?.active) {
    const projectile = game.projectile;
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;

    if (projectile.x < projectile.radius || projectile.x > game.width - projectile.radius) {
      projectile.vx *= -1;
      projectile.x = clamp(projectile.x, projectile.radius, game.width - projectile.radius);
    }

    for (const bubble of game.bubbles) {
      if (!bubble.hit && distance(projectile, bubble) < projectile.radius + bubble.radius * 0.88) {
        projectile.active = false;
        attachProjectile(game, projectile, bubble);
        break;
      }
    }

    if (game.projectile && projectile.y <= projectile.radius + 8) {
      projectile.active = false;
      attachProjectile(game, projectile);
    }

    if (game.projectile && projectile.y > game.height + 60) {
      game.projectile = null;
      game.streak = 0;
    }
  }

  game.particles = game.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx,
      y: particle.y + particle.vy,
      vy: particle.vy + 0.04,
      life: particle.life - 0.022
    }))
    .filter((particle) => particle.life > 0);

  game.bubbles.forEach((bubble) => {
    bubble.pulse += 0.025;
  });

  if (activeBubbles(game).length === 0) {
    game.bubbles = createBubbleField(game.width, game.height);
    game.streak += 3;
    game.score += 800;
  }

  updateGameOver(game);
}

function drawBackground(ctx: CanvasRenderingContext2D, game: GameState) {
  const gradient = ctx.createLinearGradient(0, 0, game.width, game.height);
  gradient.addColorStop(0, '#071014');
  gradient.addColorStop(0.56, '#0b171d');
  gradient.addColorStop(1, '#10140e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, game.width, game.height);

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = 'rgba(125, 211, 221, 0.13)';
  ctx.lineWidth = 1;
  const grid = 48;
  for (let x = 0; x < game.width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - game.height * 0.18, game.height);
    ctx.stroke();
  }
  for (let y = 0; y < game.height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(game.width, y + game.width * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBubble(ctx: CanvasRenderingContext2D, bubble: Bubble, sprites: Record<string, HTMLCanvasElement>) {
  if (bubble.hit) {
    return;
  }

  const sprite = sprites[bubble.color];
  if (sprite) {
    ctx.save();
    const shimmer = Math.sin(bubble.pulse) * 0.12 + 0.88;
    ctx.globalAlpha = shimmer;
    ctx.shadowBlur = 18;
    ctx.shadowColor = bubble.color;
    ctx.drawImage(
      sprite,
      bubble.x - bubble.radius,
      bubble.y - bubble.radius,
      bubble.radius * 2,
      bubble.radius * 2
    );
    ctx.restore();
  } else {
    const shimmer = Math.sin(bubble.pulse) * 0.12 + 0.88;
    const gradient = ctx.createRadialGradient(
      bubble.x - bubble.radius * 0.34,
      bubble.y - bubble.radius * 0.38,
      bubble.radius * 0.12,
      bubble.x,
      bubble.y,
      bubble.radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.18, bubble.color);
    gradient.addColorStop(1, '#071014');

    ctx.save();
    ctx.globalAlpha = shimmer;
    ctx.fillStyle = gradient;
    ctx.shadowBlur = 18;
    ctx.shadowColor = bubble.color;
    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();
    ctx.restore();
  }
}

function drawSlingshot(ctx: CanvasRenderingContext2D, game: GameState, sprites: Record<string, HTMLCanvasElement>) {
  const { anchor, aim, charge } = game;
  const forkLeft = { x: anchor.x - 38, y: anchor.y - 24 };
  const forkRight = { x: anchor.x + 38, y: anchor.y - 24 };
  const handle = { x: anchor.x, y: anchor.y + 52 };
  const pullPoint = {
    x: anchor.x - aim.x * (44 + charge * 110),
    y: anchor.y - aim.y * (44 + charge * 110)
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 18;
  ctx.shadowColor = 'rgba(255,181,54,0.24)';

  ctx.strokeStyle = '#ffb536';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(handle.x, handle.y);
  ctx.quadraticCurveTo(anchor.x - 26, anchor.y + 8, forkLeft.x, forkLeft.y);
  ctx.moveTo(handle.x, handle.y);
  ctx.quadraticCurveTo(anchor.x + 26, anchor.y + 8, forkRight.x, forkRight.y);
  ctx.stroke();

  ctx.strokeStyle = `rgba(38,236,221,${0.42 + charge * 0.38})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(forkLeft.x, forkLeft.y);
  ctx.lineTo(pullPoint.x, pullPoint.y);
  ctx.lineTo(forkRight.x, forkRight.y);
  ctx.stroke();

  const sprite = sprites[game.nextColor];
  if (sprite) {
    ctx.drawImage(
      sprite,
      pullPoint.x - 20,
      pullPoint.y - 20,
      40,
      40
    );
  } else {
    const projectileGradient = ctx.createRadialGradient(pullPoint.x - 6, pullPoint.y - 8, 3, pullPoint.x, pullPoint.y, 24);
    projectileGradient.addColorStop(0, '#ffffff');
    projectileGradient.addColorStop(0.28, game.nextColor);
    projectileGradient.addColorStop(1, '#071014');
    ctx.fillStyle = projectileGradient;
    ctx.beginPath();
    ctx.arc(pullPoint.x, pullPoint.y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.setLineDash([9, 12]);
  ctx.strokeStyle = 'rgba(237,248,250,0.34)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(anchor.x + aim.x * 320, anchor.y + aim.y * 320);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawDangerLine(ctx: CanvasRenderingContext2D, game: GameState) {
  const dangerLine = game.anchor.y - Math.max(118, game.height * 0.16);

  ctx.save();
  ctx.setLineDash([14, 12]);
  ctx.strokeStyle = game.gameOver ? 'rgba(255,95,143,0.72)' : 'rgba(255,95,143,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, dangerLine);
  ctx.lineTo(game.width - 24, dangerLine);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = game.gameOver ? 'rgba(255,95,143,0.86)' : 'rgba(255,95,143,0.42)';
  ctx.font = '700 11px JetBrains Mono, monospace';
  ctx.fillText('DANGER LINE', 28, dangerLine - 10);
  ctx.restore();
}

function drawProjectile(ctx: CanvasRenderingContext2D, projectile: Projectile | null, sprites: Record<string, HTMLCanvasElement>) {
  if (!projectile?.active) {
    return;
  }

  const sprite = sprites[projectile.color];
  if (sprite) {
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = projectile.color;
    ctx.drawImage(
      sprite,
      projectile.x - projectile.radius,
      projectile.y - projectile.radius,
      projectile.radius * 2,
      projectile.radius * 2
    );
    ctx.restore();
  } else {
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = projectile.color;
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const particle of particles) {
    ctx.save();
    ctx.globalAlpha = particle.life;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 3 + particle.life * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawGame(ctx: CanvasRenderingContext2D, game: GameState, sprites: Record<string, HTMLCanvasElement>) {
  drawBackground(ctx, game);
  game.bubbles.forEach((bubble) => drawBubble(ctx, bubble, sprites));
  drawParticles(ctx, game.particles);
  drawProjectile(ctx, game.projectile, sprites);
  drawDangerLine(ctx, game);
  drawSlingshot(ctx, game, sprites);

  ctx.save();
  ctx.fillStyle = 'rgba(237,248,250,0.62)';
  ctx.font = '600 12px JetBrains Mono, monospace';
  ctx.fillText('HAND VECTOR INPUT', 24, game.height - 28);
  ctx.restore();

  if (game.gameOver) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,10,13,0.74)';
    ctx.fillRect(0, 0, game.width, game.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5f8f';
    ctx.font = '800 44px Inter, system-ui, sans-serif';
    ctx.fillText('GAME OVER', game.width / 2, game.height / 2 - 20);
    ctx.fillStyle = 'rgba(237,248,250,0.78)';
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.fillText('Bubbles reached the slingshot danger line', game.width / 2, game.height / 2 + 18);
    ctx.restore();
  }
}

function statusCopy(state: CameraState) {
  if (state === 'live') return 'Live';
  if (state === 'requesting') return 'Requesting';
  if (state === 'error') return 'Offline';
  return 'Standby';
}

function gestureCopy(mode: GestureMode) {
  if (mode === 'charging') return 'Charging';
  if (mode === 'release') return 'Released';
  if (mode === 'tracking') return 'Tracking';
  return 'Searching';
}

export default function GeminiSlingshot() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<{ start: () => Promise<void>; stop: () => void } | null>(null);
  const handsRef = useRef<InstanceType<NonNullable<typeof window.Hands>> | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastHudRef = useRef(0);
  const lastModeRef = useRef<GestureMode>('searching');
  const gameRef = useRef<GameState>(createGameState());
  const gestureRef = useRef<GestureSnapshot>({
    mode: 'searching',
    confidence: 0,
    hand: null,
    aim: { x: 0, y: -1 },
    charge: 0,
    pinchDistance: 1,
    seenAt: 0
  });

  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState('');
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);

  const ballSpritesRef = useRef<Record<string, HTMLCanvasElement>>({});

  useEffect(() => {
    const img = new Image();
    img.src = ballImgUrl;
    img.onload = () => {
      const sprites: Record<string, HTMLCanvasElement> = {};

      BUBBLE_COLORS.forEach((color) => {
        const offscreen = document.createElement('canvas');
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx = offscreen.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;

        const hex = color.startsWith('#') ? color : '#ffffff';
        const tr = parseInt(hex.slice(1, 3), 16);
        const tg = parseInt(hex.slice(3, 5), 16);
        const tb = parseInt(hex.slice(5, 7), 16);

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Green detection: g > r && g > b && a > 0
          if (a > 0 && g > r && g > b) {
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const f = lum / 180.0;

            data[i] = Math.min(255, tr * f);
            data[i + 1] = Math.min(255, tg * f);
            data[i + 2] = Math.min(255, tb * f);
          }
        }

        ctx.putImageData(imgData, 0, 0);
        sprites[color] = offscreen;
      });

      ballSpritesRef.current = sprites;
    };
  }, []);

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    handsRef.current?.close?.();
    handsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState('idle');
  }, []);

  const resetGame = useCallback(() => {
    const current = gameRef.current;
    const newState = createGameState(current.width, current.height);
    newState.dpr = current.dpr;
    gameRef.current = newState;
    setHud({
      ...INITIAL_HUD,
      targets: gameRef.current.bubbles.length
    });
  }, []);

  const startCamera = useCallback(async () => {
    if (!videoRef.current || !overlayRef.current) {
      return;
    }
    if (!window.Camera || !window.Hands) {
      setCameraState('error');
      setCameraError('MediaPipe CDN 还没有加载完成，请刷新或检查网络。');
      return;
    }

    setCameraState('requesting');
    setCameraError('');

    try {
      const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.84,
        minTrackingConfidence: 0.82
      });

      hands.onResults((results) => {
        const overlay = overlayRef.current;
        const video = videoRef.current;
        const game = gameRef.current;
        if (!overlay || !video) return;

        const rect = overlay.getBoundingClientRect();
        overlay.width = Math.max(1, Math.floor(rect.width));
        overlay.height = Math.max(1, Math.floor(rect.height));
        const ctx = overlay.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, rect.width, rect.height);

        const landmarks = results.multiHandLandmarks?.[0];
        if (landmarks) {
          if (window.drawConnectors && window.HAND_CONNECTIONS) {
            window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {
              color: '#26ecdd',
              lineWidth: 2
            });
          }
          window.drawLandmarks?.(ctx, landmarks, {
            color: '#ffb536',
            lineWidth: 1,
            radius: 3
          });

          const nextGesture = mapLandmarksToGesture(landmarks, game.width, game.height);
          const previousMode = lastModeRef.current;
          if (previousMode === 'charging' && nextGesture.mode === 'tracking' && gestureRef.current.charge > 0.34) {
            nextGesture.mode = 'release';
          }
          lastModeRef.current = nextGesture.mode === 'release' ? 'tracking' : nextGesture.mode;
          gestureRef.current = nextGesture;
        } else {
          gestureRef.current = {
            ...gestureRef.current,
            mode: 'searching',
            confidence: 0,
            charge: 0,
            seenAt: 0
          };
          lastModeRef.current = 'searching';
        }
      });

      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await hands.send({ image: videoRef.current });
          }
        },
        width: 640,
        height: 480,
        facingMode: 'user'
      });

      handsRef.current = hands;
      cameraRef.current = camera;
      await camera.start();
      setCameraState('live');
    } catch (error) {
      const message = error instanceof Error ? error.message : '摄像头启动失败。';
      setCameraState('error');
      setCameraError(message);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapRef.current;
    if (!canvas || !wrapper) {
      return undefined;
    }

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(360, rect.width);
      const height = Math.max(420, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      const game = gameRef.current;
      const needsFreshField = Math.abs(game.width - width) > 24 || Math.abs(game.height - height) > 24;
      game.width = width;
      game.height = height;
      game.dpr = dpr;
      game.anchor = { x: width * 0.5, y: height * 0.78 };
      if (needsFreshField) {
        game.bubbles = createBubbleField(width, height);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

    const tick = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(gameRef.current.dpr, 0, 0, gameRef.current.dpr, 0, 0);
        updateGame(gameRef.current, gestureRef.current);
        drawGame(ctx, gameRef.current, ballSpritesRef.current);
      }

      const now = performance.now();
      if (now - lastHudRef.current > 180) {
        const game = gameRef.current;
        setHud({
          score: game.score,
          streak: game.streak,
          charge: game.charge,
          shots: game.shots,
          targets: game.bubbles.filter((bubble) => !bubble.hit).length,
          gestureMode: gestureRef.current.mode,
          confidence: gestureRef.current.confidence,
          gameOver: game.gameOver
        });
        lastHudRef.current = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      observer.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const telemetry = useMemo(
    () => [
      { label: 'Score', value: hud.score.toLocaleString(), icon: Zap },
      { label: 'Charge', value: `${Math.round(hud.charge * 100)}%`, icon: Activity },
      { label: 'Targets', value: hud.targets.toString(), icon: Crosshair },
      { label: 'Shots', value: hud.shots.toString(), icon: RadioTower }
    ],
    [hud]
  );

  return (
    <main className="h-screen w-screen overflow-hidden bg-graphite-950 text-slate-100">
      <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <header className="material-panel col-span-1 flex min-h-16 items-center justify-between rounded-lg px-4 lg:col-span-2">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200 shadow-glow">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight tracking-normal text-white">Slingshot</h1>
              <p className="text-xs font-medium uppercase tracking-normal text-cyan-100/60">
                Gesture bubble shooter
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {telemetry.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex h-11 min-w-24 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.04] px-3">
                  <Icon size={16} className="text-cyan-200" />
                  <div>
                    <div className="text-[11px] font-medium uppercase leading-none tracking-normal text-slate-400">{item.label}</div>
                    <div className="mt-1 font-mono text-sm font-semibold leading-none text-white">{item.value}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        <aside className="material-panel hidden min-h-0 flex-col rounded-lg p-3 lg:flex">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Camera size={17} className="text-cyan-200" />
              Camera
            </div>
            <span className="rounded-md border border-cyan-200/15 bg-cyan-200/10 px-2 py-1 text-xs font-semibold text-cyan-100">
              {statusCopy(cameraState)}
            </span>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-black">
            <video ref={videoRef} className="h-full w-full -scale-x-100 object-cover opacity-80" playsInline muted />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />
            {cameraState !== 'live' && (
              <div className="absolute inset-0 grid place-items-center bg-graphite-950/72 text-center">
                <div>
                  <Hand className="mx-auto mb-2 text-cyan-200" size={28} />
                  <p className="text-sm font-semibold text-white">Hand tracking standby</p>
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={cameraState === 'live' ? stopCamera : startCamera}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 text-sm font-bold text-slate-950 shadow-glow transition hover:bg-cyan-200"
            >
              <Play size={16} />
              {cameraState === 'live' ? 'Stop' : 'Start Camera'}
            </button>
            <button
              type="button"
              onClick={resetGame}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
            >
              <RefreshCw size={16} />
              Reset
            </button>
          </div>
          {cameraError && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs leading-5 text-red-100">{cameraError}</p>}
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Gesture Lock</span>
              <span className="font-semibold text-amber-200">{gestureCopy(hud.gestureMode)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-300 transition-[width]" style={{ width: `${Math.round(hud.confidence * 100)}%` }} />
            </div>
            <p className="text-xs leading-5 text-slate-400">
              捏住拇指和食指开始蓄力，移动手势改变瞄准方向，松开手指发射泡泡。
            </p>
          </div>
        </aside>

        <section ref={wrapRef} className="material-panel relative min-h-0 overflow-hidden rounded-lg">
          <canvas ref={canvasRef} className="block h-full w-full" />
          <div className="pointer-events-none absolute left-4 top-4 grid grid-cols-2 gap-2 md:hidden">
            {telemetry.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-black/28 px-2 backdrop-blur">
                  <Icon size={14} className="text-cyan-200" />
                  <span className="font-mono text-xs font-semibold text-white">{item.value}</span>
                </div>
              );
            })}
          </div>
          <div className="absolute right-4 top-4 hidden gap-2 lg:hidden md:flex">
            <button
              type="button"
              onClick={cameraState === 'live' ? stopCamera : startCamera}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 text-sm font-bold text-slate-950 shadow-glow transition hover:bg-cyan-200"
            >
              <Camera size={16} />
              {cameraState === 'live' ? 'Stop' : 'Start Camera'}
            </button>
            <button
              type="button"
              onClick={resetGame}
              className="grid size-10 place-items-center rounded-lg border border-white/10 bg-black/30 text-white backdrop-blur transition hover:bg-white/10"
              aria-label="Reset game"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="absolute bottom-16 left-4 right-4 grid grid-cols-2 gap-2 md:hidden">
            <button
              type="button"
              onClick={cameraState === 'live' ? stopCamera : startCamera}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-2 text-xs font-bold text-slate-950 shadow-glow transition hover:bg-cyan-200"
            >
              <Camera size={15} />
              {cameraState === 'live' ? 'Stop' : 'Camera'}
            </button>
            <button
              type="button"
              onClick={resetGame}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/10"
            >
              <RefreshCw size={15} />
              Reset
            </button>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-lg border border-white/10 bg-black/28 px-3 py-2 backdrop-blur">
            <span className="text-xs font-semibold uppercase tracking-normal text-slate-300">
              {hud.gameOver ? 'Game Over' : `Mode ${gestureCopy(hud.gestureMode)}`}
            </span>
            <span className="font-mono text-xs text-cyan-100">Charge {Math.round(hud.charge * 100)}%</span>
          </div>
          {hud.gameOver && (
            <div className="absolute inset-0 grid place-items-center">
              <button
                type="button"
                onClick={resetGame}
                className="rounded-lg bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-glow transition hover:bg-cyan-200"
              >
                Restart Game
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
