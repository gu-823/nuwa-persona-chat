import { useEffect, useRef, useState } from "react";

const names = ["Jobs", "Marx", "苏东坡", "Socrates", "Trump", "张雪峰", "Musk", "毛泽东", "KUN"];

interface IntroLoaderProps {
  ready: boolean;
  onDone: () => void;
}

export function IntroLoader({ ready, onDone }: IntroLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedAtRef = useRef(Date.now());
  const finishedRef = useRef(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let readyTimer = 0;
    if (ready) {
      const elapsed = Date.now() - startedAtRef.current;
      readyTimer = window.setTimeout(finish, Math.max(2800 - elapsed, 0));
    }
    const maxTimer = window.setTimeout(finish, 5000);
    return () => {
      window.clearTimeout(readyTimer);
      window.clearTimeout(maxTimer);
    };
  }, [ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let animationId = 0;
    const particles = Array.from({ length: 94 }, (_, index) => ({
      orbit: 42 + (index % 17) * 10,
      angle: (index / 94) * Math.PI * 2,
      speed: 0.002 + (index % 9) * 0.0006,
      size: 0.8 + (index % 5) * 0.28
    }));

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * ratio);
      canvas.height = Math.floor(canvas.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      frame += 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#090807";
      ctx.fillRect(0, 0, width, height);

      const pulse = Math.sin(frame * 0.018) * 0.5 + 0.5;
      ctx.strokeStyle = `rgba(199,169,107,${0.1 + pulse * 0.16})`;
      ctx.lineWidth = 1;

      for (let ring = 0; ring < 4; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, 110 + ring * 46, 34 + ring * 16, frame * 0.002 * (ring + 1), 0, Math.PI * 2);
        ctx.stroke();
      }

      const points: Array<{ x: number; y: number }> = [];
      for (const particle of particles) {
        particle.angle += particle.speed;
        const weave = Math.sin(frame * 0.012 + particle.orbit) * 22;
        const x = centerX + Math.cos(particle.angle) * (particle.orbit + weave);
        const y = centerY + Math.sin(particle.angle * 1.7) * (particle.orbit * 0.38);
        points.push({ x, y });
        ctx.fillStyle = particle.angle % 0.9 < 0.04 ? "rgba(168,79,61,0.82)" : "rgba(241,236,224,0.72)";
        ctx.beginPath();
        ctx.arc(x, y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < points.length; i += 7) {
        const a = points[i];
        const b = points[(i + 19) % points.length];
        ctx.strokeStyle = "rgba(241,236,224,0.08)";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      animationId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setVisible(false);
    window.setTimeout(onDone, 420);
  };

  if (!visible) return <div className="intro-loader intro-loader--leaving" aria-hidden="true" />;

  return (
    <div className="intro-loader">
      <canvas ref={canvasRef} className="intro-canvas" />
      <div className="intro-vignette" />
      <div className="intro-copy">
        <div className="intro-mark">女娲</div>
        <div className="intro-line" />
        <h1>唤醒一组可对话的思维</h1>
        <p>公开资料被拆解、蒸馏、重组为可运行的人格镜片。</p>
        <div className="intro-name-stream" aria-label="预置人物">
          {names.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </div>
      <button className="intro-skip" type="button" onClick={finish}>
        跳过
      </button>
    </div>
  );
}
