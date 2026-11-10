import type { Scene } from './base';

/** Frames per second per variant: the full scene runs smoothly, previews stay light. */
const FPS = { full: 60, card: 30 } as const;
const WARMUP_STEPS = 75; // ~2.5s, so a scene never starts empty

const hosts = new Set<SceneHost>();
let raf = 0;
let last = 0;

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  if (dt > 0) for (const h of hosts) h.frame(dt);
}

/** Puts a scene on a canvas: sizing, the shared animation loop, visibility. */
export class SceneHost {
  paused = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ro: ResizeObserver;
  private readonly io: IntersectionObserver;
  private visible = true;
  private acc = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly scene: Scene) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => {
      if (this.sync()) this.render();
    });
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) this.visible = e.isIntersecting;
    });
    this.ro.observe(canvas);
    this.io.observe(canvas);
    if (this.sync()) this.render();
    hosts.add(this);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  /** Match the scene to the canvas's current size. Returns false while the canvas has no size. */
  sync() {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return false;
    const sc = this.scene;
    if (w === sc.w && h === sc.h) return true;
    const dpr = Math.min(window.devicePixelRatio || 1, w > 900 ? 1.5 : 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    sc.resize(w, h, dpr);
    if (!sc.warmed) {
      sc.warmed = true;
      for (let i = 0; i < WARMUP_STEPS; i++) sc.step(1 / 30);
    }
    return true;
  }

  frame(dt: number) {
    if (this.paused || !this.visible || !this.scene.warmed || document.hidden) return;
    this.acc += dt;
    const min = 1 / FPS[this.scene.variant];
    if (this.acc < min * 0.9) return;
    const step = Math.min(this.acc, 0.1);
    this.acc = 0;
    this.scene.step(step);
    this.render();
  }

  render() {
    const { ctx, scene } = this;
    ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
    scene.draw(ctx);
  }

  /** Page coordinates → scene coordinates. */
  toScene(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left) * (this.scene.w / r.width), (clientY - r.top) * (this.scene.h / r.height)];
  }

  destroy() {
    hosts.delete(this);
    this.ro.disconnect();
    this.io.disconnect();
    if (!hosts.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }
  }
}
