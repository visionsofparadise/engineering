import { useEffect, useRef } from 'react';

const VERT = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
out vec4 fragColor;

const float SPEED = 5.8;
const float CAM_HEIGHT = 14.5;
const float LOOK_DOWN = -1.1;
const float FOV = 0.5;
const float FOG_DENSITY = 0.055;
const float FOG_START = 30.0;
const float TERRAIN_SCALE = 0.05;
const float TERRAIN_AMP = 4.1;
const float ROTATION = radians(-29.0);
const float COLOR_MIN = 1.1;
const float COLOR_MAX = 8.0;
const float SWAY_AMT = 3.0;
const float SWAY_SPEED = 0.5;
const float TROUGH = 0.004;
const float COS_ROT = cos(ROTATION);
const float SIN_ROT = sin(ROTATION);

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float ridgedFbm(vec2 p) {
  float n0 = 1.0 - abs(snoise(p));
  float n1 = 1.0 - abs(snoise(p * 2.0));
  float n2 = 1.0 - abs(snoise(p * 4.0));
  return n0 * n0 * 0.5 + n1 * n1 * 0.25 + n2 * n2 * 0.125;
}

float terrainBase(vec2 p) {
  vec2 sp = p * TERRAIN_SCALE;
  return (ridgedFbm(sp * 0.3) * 2.0 + ridgedFbm(sp * 0.7 + 3.7) * 0.8) * TERRAIN_AMP;
}

float terrain(vec2 p, float camX) {
  float dx = p.x - camX;
  return terrainBase(p) + dx * dx * TROUGH;
}

vec3 lavaColormap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.0, 0.0, 0.0);
  vec3 c1 = vec3(15.0, 20.0, 70.0);
  vec3 c2 = vec3(80.0, 10.0, 5.0);
  vec3 c3 = vec3(185.0, 55.0, 0.0);
  vec3 c4 = vec3(240.0, 155.0, 25.0);
  vec3 c5 = vec3(255.0, 255.0, 255.0);
  vec3 col = mix(c0, c1, smoothstep(0.0, 0.2, t));
  col = mix(col, c2, smoothstep(0.2, 0.35, t));
  col = mix(col, c3, smoothstep(0.35, 0.55, t));
  col = mix(col, c4, smoothstep(0.55, 0.75, t));
  col = mix(col, c5, smoothstep(0.75, 1.0, t));
  return col / 255.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;

  float t = u_time * SPEED;

  float swayX = sin(u_time * SWAY_SPEED) * SWAY_AMT;
  float swayY = cos(u_time * SWAY_SPEED * 0.7) * SWAY_AMT * 0.3;

  vec3 camPos = vec3(swayX, CAM_HEIGHT + swayY, t);
  vec3 camTarget = vec3(swayX * 0.5, CAM_HEIGHT - LOOK_DOWN, t + 5.0);
  vec3 camUp = vec3(0.0, 1.0, 0.0);

  vec3 cw = normalize(camTarget - camPos);
  vec3 cu = normalize(cross(cw, camUp));
  vec3 cv = cross(cu, cw);

  vec2 screen = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  screen = vec2(screen.x * COS_ROT - screen.y * SIN_ROT, screen.x * SIN_ROT + screen.y * COS_ROT);

  vec3 rd = normalize(screen.x * cu + screen.y * cv + FOV * cw);

  vec3 voidColor = vec3(2.0 / 255.0, 2.0 / 255.0, 4.0 / 255.0);

  float tRay = 0.0;
  bool hit = false;
  vec3 hitPos;

  for (int i = 0; i < 64; i++) {
    hitPos = camPos + rd * tRay;
    float h = terrain(hitPos.xz, camPos.x);
    float dist = hitPos.y - h;

    if (dist < 0.1) {
      hit = true;
      break;
    }

    tRay += max(dist * 0.6, 0.16);

    if (tRay > 60.0) break;
  }

  vec3 col = voidColor;

  if (hit) {
    float h = terrainBase(hitPos.xz);
    float normalizedH = clamp((h - COLOR_MIN) / (COLOR_MAX - COLOR_MIN), 0.0, 1.0);
    col = lavaColormap(normalizedH);

    float fogDist = max(tRay - FOG_START, 0.0);
    float fogFactor = 1.0 - exp(-fogDist * FOG_DENSITY);
    col = mix(col, voidColor, fogFactor);
  } else {
    vec3 lavaBlue = vec3(15.0, 20.0, 70.0) / 255.0;
    float skyGrad = smoothstep(-0.2, 0.5, rd.y);
    col = mix(lavaBlue, voidColor, skyGrad);
  }

  fragColor = vec4(col, 1.0);
}
`;

const DPR = 0.5;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);

  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);

    return null;
  }

  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);

    return null;
  }

  return program;
}

export function TerrainShader({ className }: { readonly className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });

    if (!gl) return;

    const vert = createShader(gl, gl.VERTEX_SHADER, VERT);
    const frag = createShader(gl, gl.FRAGMENT_SHADER, FRAG);

    if (!vert || !frag) return;

    const program = createProgram(gl, vert, frag);

    if (!program) return;

    const posAttr = gl.getAttribLocation(program, 'a_position');
    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');

    const buffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, DPR);
      const rect = canvas.getBoundingClientRect();

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    resize();
    const observer = new ResizeObserver(resize);

    observer.observe(canvas);

    const startTime = performance.now();

    const render = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const time = reducedMotion ? 0 : elapsed;

      gl.useProgram(program);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);

      gl.enableVertexAttribArray(posAttr);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    />
  );
}
