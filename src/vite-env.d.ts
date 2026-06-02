/// <reference types="vite/client" />

declare global {
  interface Window {
    Camera?: new (
      videoElement: HTMLVideoElement,
      options: {
        onFrame: () => Promise<void>;
        width?: number;
        height?: number;
        facingMode?: 'user' | 'environment';
      }
    ) => {
      start: () => Promise<void>;
      stop: () => void;
    };
    Hands?: new (options: { locateFile: (file: string) => string }) => {
      setOptions: (options: Record<string, unknown>) => void;
      onResults: (callback: (results: MediaPipeHandsResults) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
      close?: () => void;
    };
    drawConnectors?: (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      connections: unknown,
      options?: Record<string, unknown>
    ) => void;
    drawLandmarks?: (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      options?: Record<string, unknown>
    ) => void;
    HAND_CONNECTIONS?: unknown;
  }

  interface Landmark {
    x: number;
    y: number;
    z: number;
  }

  interface MediaPipeHandsResults {
    image: HTMLVideoElement | HTMLCanvasElement | ImageBitmap;
    multiHandLandmarks?: Landmark[][];
    multiHandedness?: Array<{ label: string; score: number }>;
  }
}

export {};
