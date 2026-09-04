import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export interface ZoomPanTransform { scale: number; tx: number; ty: number; }

const DEFAULT: ZoomPanTransform = { scale: 1, tx: 0, ty: 0 };

/** Lightweight wheel-zoom + drag-pan for an SVG canvas — no library needed. */
export function useZoomPan() {
  const [transform, setTransform] = useState<ZoomPanTransform>(DEFAULT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setTransform((s) => ({ ...s, scale: Math.min(3, Math.max(0.15, s.scale * (1 + delta))) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    dragging.current = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
  }, [transform.tx, transform.ty]);
  const onMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!dragging.current) return;
    const d = dragging.current;
    setTransform((s) => ({ ...s, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  }, []);
  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  const zoomIn = useCallback(() => setTransform((s) => ({ ...s, scale: Math.min(3, s.scale * 1.25) })), []);
  const zoomOut = useCallback(() => setTransform((s) => ({ ...s, scale: Math.max(0.15, s.scale / 1.25) })), []);
  const reset = useCallback(() => setTransform(DEFAULT), []);

  /** Fit a content box of size (w,h) into the container, centered. */
  const fit = useCallback((w: number, h: number) => {
    const el = containerRef.current;
    if (!el || w <= 0 || h <= 0) { setTransform(DEFAULT); return; }
    const cw = el.clientWidth || 800, ch = el.clientHeight || 480;
    const scale = Math.min(1.1, Math.max(0.2, Math.min(cw / w, ch / h) * 0.92));
    setTransform({ scale, tx: (cw - w * scale) / 2, ty: (ch - h * scale) / 2 });
  }, []);

  return { containerRef, transform, setTransform, onMouseDown, onMouseMove, onMouseUp, zoomIn, zoomOut, reset, fit };
}
