// Port of `pikaraoke/static/fireworks.js`, adapted to a canvas element.

type FireworkParticle = {
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
};

class Firework {
  x: number;
  y: number;
  color: string;
  particles: FireworkParticle[];

  constructor(x: number, y: number, color: string) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.particles = Array.from({ length: 50 }, () => ({
      x,
      y,
      angle: Math.random() * 2 * Math.PI,
      speed: Math.random() * 2 + 1,
      radius: Math.random() * 6 + 3,
    }));
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.particles.forEach(particle => {
      const dx = Math.cos(particle.angle) * particle.speed;
      const dy = Math.sin(particle.angle) * particle.speed;
      particle.x += dx;
      particle.y += dy;
      particle.radius *= 0.98;

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.fill();
    });
  }
}

export function launchFireworkShow(canvas: HTMLCanvasElement, score: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  let fireworks: Firework[] = [];

  const addFirework = () => {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.6;
    const color = `hsl(${Math.random() * 360}, 100%, 60%)`;
    fireworks.push(new Firework(x, y, color));
  };

  const animateFireworks = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    fireworks.forEach((firework, index) => {
      firework.draw(ctx);
      firework.particles = firework.particles.filter(p => p.radius > 0.5);
      if (firework.particles.length === 0) fireworks.splice(index, 1);
    });

    if (fireworks.length > 0) {
      requestAnimationFrame(animateFireworks);
    }
  };

  const launchMultipleFireworks = (count: number) => {
    for (let i = 0; i < count; i++) addFirework();
    animateFireworks();
  };

  const showDuration = 5000;
  const startTime = Date.now();
  let simultaneousFireworks = 1;
  let intensity = 1300;

  if (score < 30) {
    simultaneousFireworks = 1;
    intensity = 1300;
  } else if (score < 60) {
    simultaneousFireworks = 2;
    intensity = 800;
  } else {
    simultaneousFireworks = 3;
    intensity = 500;
  }

  const launchInterval = () => {
    if (Date.now() - startTime > showDuration) return;

    const fireworkCount =
      Math.floor(Math.random() * simultaneousFireworks) + simultaneousFireworks;
    launchMultipleFireworks(fireworkCount);

    const nextInterval = Math.random() * intensity + 200;
    setTimeout(launchInterval, nextInterval);
  };

  launchInterval();
}
