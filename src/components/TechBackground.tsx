import { useEffect, useRef } from "react";

export default function TechBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const drawAccents = () => {
      const gradient1 = ctx.createRadialGradient(
        canvas.width * 0.8,
        canvas.height * 0.2,
        0,
        canvas.width * 0.8,
        canvas.height * 0.2,
        canvas.width * 0.3
      );
      gradient1.addColorStop(0, "rgba(255, 255, 255, 0.06)");
      gradient1.addColorStop(1, "transparent");

      ctx.fillStyle = gradient1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const gradient2 = ctx.createRadialGradient(
        canvas.width * 0.2,
        canvas.height * 0.8,
        0,
        canvas.width * 0.2,
        canvas.height * 0.8,
        canvas.width * 0.25
      );
      gradient2.addColorStop(0, "rgba(255, 79, 216, 0.06)");
      gradient2.addColorStop(1, "transparent");

      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawGeometricShapes = () => {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(canvas.width * 0.1, canvas.height * 0.3, canvas.width * 0.15, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(canvas.width * 0.9, canvas.height * 0.7, canvas.width * 0.12, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.6, canvas.height * 0.1);
      ctx.lineTo(canvas.width * 0.65, canvas.height * 0.2);
      ctx.lineTo(canvas.width * 0.55, canvas.height * 0.2);
      ctx.closePath();
      ctx.stroke();
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawAccents();
      drawGeometricShapes();
    };

    draw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />;
}
