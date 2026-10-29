import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { cx } from './ui';

type BurnerState = 'idle' | 'muted' | 'listening' | 'hearing' | 'speaking';

export type GusteauIconProps = {
  size?: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
  state?: BurnerState;
  level?: number;
  debugInteractive?: boolean;
};

const vertexShader = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uMode;
uniform float uLevel;
uniform float uIgnition;
uniform float uPress;
uniform float uVoiceInput;

float sdRoundCylinder(vec3 p, float radius, float halfHeight, float roundness) {
  vec2 d = abs(vec2(length(p.xz) - radius, p.y)) - vec2(roundness, halfHeight);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - roundness;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float radius) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

float smoothMinimum(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

vec2 solidScene(vec3 p) {
  float d = sdRoundCylinder(p - vec3(0.0, -0.39, 0.0), 0.91, 0.24, 0.075);
  float material = 1.0;

  float well = sdRoundCylinder(p - vec3(0.0, -0.135, 0.0), 0.76, 0.025, 0.018);
  if (well < d) { d = well; material = 2.0; }

  float mutedMotion = step(0.08, uMode) * (1.0 - step(0.5, uMode));
  float grateMotion = mutedMotion * sin(uTime * 5.2) * 0.035;
  float rim = length(vec2(length(p.xz) - 0.77, p.y + 0.103 + grateMotion)) - 0.045;
  if (rim < d) { d = rim; material = 3.0; }

  for (int i = 0; i < 4; i++) {
    float angle = 0.785398 + 1.570796 * float(i) + grateMotion;
    vec3 direction = vec3(cos(angle), 0.0, sin(angle));
    float grateHeight = -0.088 + mutedMotion * sin(uTime * 5.2 + float(i) * 1.57) * 0.025;
    float grate = sdCapsule(p, direction * vec3(0.25, 0.0, 0.25) + vec3(0.0, grateHeight, 0.0),
      direction * vec3(0.83, 0.0, 0.83) + vec3(0.0, grateHeight, 0.0), 0.042);
    if (grate < d) { d = grate; material = 3.0; }
  }

  for (int i = 0; i < 7; i++) {
    float angle = 1.570796 - 0.897598 * float(i);
    vec2 port = 0.66 * vec2(cos(angle), sin(angle));
    float dotPulse = mutedMotion * (0.5 + 0.5 * sin(uTime * 5.2 - float(i) * 0.92));
    float dotWell = sdRoundCylinder(p - vec3(port.x, -0.12 + dotPulse * 0.012, port.y), 0.048, 0.018, 0.012);
    if (dotWell < d) { d = dotWell; material = 7.0; }
  }

  if (uMode < 0.5 && uIgnition < 0.08) {
    float cap = sdRoundCylinder(
      p - vec3(0.0, -0.064 - uPress * 0.14, 0.0),
      0.53 - uPress * 0.035,
      0.045,
      0.04
    );
    if (cap < d) { d = cap; material = 6.0; }
  }

  float groundDistance = max(p.y + 0.715, length(p.xz) - 1.32);
  if (groundDistance < d) { d = groundDistance; material = 5.0; }
  return vec2(d, material);
}

vec2 scene(vec3 p) {
  vec2 solid = solidScene(p);
  float flameActivity = max(step(0.5, uMode), uIgnition);
  float listeningFlame = (1.0 - smoothstep(1.62, 1.96, uMode)) * flameActivity;
  if (listeningFlame > 0.01 || uIgnition > 0.01) {
    float height = (0.5 + 0.22 * clamp(uLevel, 0.0, 1.0)) * max(listeningFlame, uIgnition);
    for (int i = 0; i < 7; i++) {
      float angle = 1.570796 - 0.897598 * float(i);
      vec2 port = 0.66 * vec2(cos(angle), sin(angle));
      vec3 q = p - vec3(port.x, -0.115, port.y);
      float t = clamp(q.y / max(height, 0.001), 0.0, 1.0);
      vec2 outward = normalize(port);
      vec2 sideways = vec2(-outward.y, outward.x);
      float flicker = 0.76 + 0.24 * sin(uTime * (8.0 + float(i) * 0.7) + float(i) * 2.1);
      vec2 sway = outward * (0.32 * t * t * flicker);
      sway += sideways * sin(uTime * 4.2 + float(i) * 1.8 + t * 3.0) * 0.045 * t;
      sway += vec2(uPointer.x, -uPointer.y) * 0.025 * t;
      float width = (0.025 + 0.115 * sin(3.141593 * pow(t, 0.82))) * (1.0 - 0.58 * t) * flicker * max(listeningFlame, uIgnition);
      float ends = max(-q.y, q.y - height);
      float flame = max(length(q.xz - sway) - width, ends);
      float innerFlame = max(length(q.xz - sway) - width * 0.5, ends);
      flame = smoothMinimum(flame, innerFlame, 0.03);
      if (flame < solid.x) solid = vec2(flame, 4.0);
    }
  }

  float speakingFlame = smoothstep(1.62, 1.96, uMode) * flameActivity;
  if (speakingFlame > 0.01) {
    vec3 q = p - vec3(uPointer.x * 0.04, -0.105, 0.0);
    float speakingHeight = 0.82 + 0.28 * clamp(uLevel, 0.0, 1.0);
    float t = clamp(q.y / speakingHeight, 0.0, 1.0);
    float speakingFlicker = 0.82 + 0.18 * sin(uTime * 9.0 + t * 5.0);
    float width = (0.035 + 0.22 * sin(3.141593 * pow(t, 0.76))) * (1.0 - 0.62 * t) * speakingFlicker;
    vec2 sway = vec2(sin(uTime * 2.8 + t * 4.0) * 0.1 * t + uPointer.x * 0.05 * t, 0.0);
    float plume = max(length(q.xz - sway) - width, max(-q.y, q.y - speakingHeight));
    if (plume < solid.x) solid = vec2(plume, 4.0);
  }
  return solid;
}

vec3 normalAt(vec3 p) {
  const float e = 0.0018;
  return normalize(vec3(
    scene(p + vec3(e, 0.0, 0.0)).x - scene(p - vec3(e, 0.0, 0.0)).x,
    scene(p + vec3(0.0, e, 0.0)).x - scene(p - vec3(0.0, e, 0.0)).x,
    scene(p + vec3(0.0, 0.0, e)).x - scene(p - vec3(0.0, 0.0, e)).x
  ));
}

float softShadow(vec3 p, vec3 lightDirection) {
  float result = 1.0;
  float distance = 0.035;
  for (int i = 0; i < 12; i++) {
    float h = solidScene(p + lightDirection * distance).x;
    result = min(result, 9.0 * h / distance);
    distance += clamp(h, 0.025, 0.16);
  }
  return clamp(result, 0.22, 1.0);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;
  vec3 camera = vec3(uPointer.x * 0.12, 3.8 + uPointer.y * 0.08, 1.7);
  vec3 forward = normalize(vec3(-uPointer.x * 0.04, -3.9 - uPointer.y * 0.08, -1.7));
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 cameraUp = normalize(cross(right, forward));
  vec3 ray = normalize(forward + right * uv.x * 0.42 + cameraUp * uv.y * 0.42);
  float travel = 0.0;
  float material = 0.0;
  vec3 point = camera;

  for (int i = 0; i < 80; i++) {
    point = camera + ray * travel;
    vec2 hitData = scene(point);
    if (hitData.x < 0.0025) { material = hitData.y; break; }
    travel += hitData.x * 0.82;
    if (travel > 7.0) break;
  }

  if (material < 0.5 || travel > 7.0) {
    outColor = vec4(0.0);
    return;
  }

  vec3 normal = normalAt(point);
  vec3 lightDirection = normalize(vec3(-0.55, 0.82, 0.92));
  vec3 viewDirection = normalize(camera - point);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float specular = pow(max(dot(normal, halfDirection), 0.0), 36.0);
  float shadow = softShadow(point + normal * 0.012, lightDirection);
  float ao = clamp(0.72 + 0.28 * normal.y, 0.45, 1.0);
  vec3 color;

  if (material < 1.5) {
    color = vec3(0.19, 0.19, 0.20);
    color *= 0.28 + diffuse * shadow * 0.72;
    color += vec3(0.78, 0.73, 0.65) * specular * 0.72;
  } else if (material < 2.5) {
    color = vec3(0.035, 0.033, 0.03) * (0.45 + diffuse * 0.35);
    color += vec3(0.19, 0.17, 0.14) * specular * 0.22;
  } else if (material < 3.5) {
    float highlight = 0.5 + 0.5 * sin(point.x * 12.0 + point.z * 9.0 + uTime * 1.2);
    float motion = step(0.5, uMode) * 0.12 * highlight;
    color = vec3(0.43, 0.40, 0.35) * (0.3 + diffuse * shadow * 0.72 + motion);
    color += vec3(1.0, 0.82, 0.58) * specular * (0.9 + motion);
  } else if (material < 4.5) {
    float height = clamp((point.y + 0.12) / 0.78, 0.0, 1.0);
    float heat = clamp(uLevel * 0.75 + 0.25, 0.0, 1.0);
    vec3 hot = mix(vec3(1.0, 0.25, 0.035), vec3(1.0, 0.65, 0.16), heat);
    color = mix(vec3(1.0, 0.94, 0.7), hot, smoothstep(0.02, 0.45, height));
    color = mix(color, vec3(0.16, 0.34, 0.95), smoothstep(0.58, 0.98, height) * 0.42);
    color = mix(color, vec3(0.12, 0.42, 1.0), uVoiceInput * 0.94);
    color *= 1.0 + 0.32 * diffuse;
  } else if (material < 5.5) {
    float radius = length(point.xz);
    float shadowShape = exp(-point.x * point.x * 2.0 - point.z * point.z * 1.6);
    float fireGlow = max(step(0.5, uMode), uIgnition) * exp(-radius * radius * 2.2);
    color = vec3(0.16, 0.145, 0.13) * (0.55 + diffuse * 0.24);
    color *= 1.0 - shadowShape * 0.56;
    color += vec3(1.0, 0.31, 0.075) * fireGlow * (0.08 + uLevel * 0.12);
  } else if (material < 6.5) {
    color = vec3(0.27, 0.25, 0.22) * (0.35 + diffuse * shadow * 0.55);
    color += vec3(0.86, 0.76, 0.62) * specular * 0.36;
  } else {
    float dotIndex = floor(mod(atan(point.z, point.x) + 6.283185, 6.283185) / 0.897598);
    float burnerLit = max(step(0.5, uMode), uIgnition);
    float wave = 0.5 + 0.5 * sin(uTime * 5.5 - dotIndex * 0.92);
    float ignitionSweep = smoothstep(0.1, 0.85, sin(uTime * 3.1 - dotIndex * 0.9));
    float muted = step(0.08, uMode) * (1.0 - step(0.5, uMode));
    float glow = burnerLit * (0.3 + 0.42 * wave + 0.28 * ignitionSweep);
    glow = max(glow, muted * 0.18 * wave);
    color = mix(vec3(0.075, 0.066, 0.055), vec3(1.0, 0.43, 0.1), glow);
    color += vec3(1.0, 0.84, 0.52) * specular * 0.42;
    color *= 0.62 + diffuse * 0.38 + glow * 0.42;
  }

  outColor = vec4(color * ao, 1.0);
}`;

const particleVertexShader = `#version 300 es
precision highp float;
in vec4 aParticle;
uniform float uTime;
uniform float uMode;
uniform float uIgnition;
uniform float uPixelRatio;
uniform vec2 uPointer;
uniform float uVoiceInput;
out float vAge;
out float vActivity;
out vec2 vDirection;
out float vStream;
void main() {
  float activity = max(smoothstep(0.45, 0.7, uMode), uIgnition);
  float speakingBlend = smoothstep(1.62, 1.96, uMode);
  float stream = smoothstep(0.45, 0.7, uMode) * (1.0 - speakingBlend);
  float age = fract(uTime * (0.72 + aParticle.y * 0.14) + aParticle.z);
  float phase = uTime * (10.0 + aParticle.w * 8.0) + aParticle.z * 31.0;
  float gust = sin(uTime * 2.3 + aParticle.z * 13.0) * age * age * 0.08;
  vec2 direction = vec2(cos(aParticle.x), sin(aParticle.x));
  float radial = mix(0.08 + age * 0.62, 0.66 + age * (0.17 + aParticle.y * 0.06), speakingBlend);
  float y = mix(-0.115, -0.11 + age * (0.18 + aParticle.y * 0.18), 1.0 - stream);
  vec3 p = vec3(
    direction.x * radial + gust + sin(phase) * 0.012 * age,
    y,
    direction.y * radial + cos(phase * 0.8) * 0.012 * age
  );
  vec3 camera = vec3(uPointer.x * 0.12, 3.8 + uPointer.y * 0.08, 1.7);
  vec3 forward = normalize(vec3(-uPointer.x * 0.04, -3.9 - uPointer.y * 0.08, -1.7));
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = normalize(cross(right, forward));
  vec3 relative = p - camera;
  float depth = max(dot(relative, forward), 0.1);
  gl_Position = vec4(dot(relative, right) * 3.9 / depth, dot(relative, up) * 3.9 / depth, 0.0, 1.0);
  gl_PointSize = mix(8.0 + aParticle.y * 3.0, 3.5 + aParticle.y * 2.0, 1.0 - stream) * uPixelRatio / depth * 4.0;
  vAge = age;
  vActivity = activity * smoothstep(0.0, 0.14, age) * (1.0 - smoothstep(0.74, 1.0, age));
  vDirection = normalize(vec2(direction.x, -direction.y * 0.42));
  vStream = stream;
}`;

const particleFragmentShader = `#version 300 es
precision mediump float;
in float vAge;
in float vActivity;
in vec2 vDirection;
in float vStream;
uniform float uVoiceInput;
out vec4 outColor;
void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float along = dot(centered, vDirection) + 0.1;
  float across = dot(centered, vec2(-vDirection.y, vDirection.x));
  float width = mix(0.12, 0.09, vStream) * (1.0 - smoothstep(0.3, 0.95, vAge) * 0.35);
  float streak = 1.0 - smoothstep(width, width + 0.035, abs(across));
  float ends = smoothstep(-0.02, 0.1, along) * (1.0 - smoothstep(0.72, 0.94, along));
  float alpha = streak * ends * vActivity * (0.55 + 0.35 * sin(vAge * 26.0));
  vec3 color = mix(vec3(1.0, 0.32, 0.07), vec3(1.0, 0.86, 0.48), smoothstep(0.1, 0.8, vAge));
  color = mix(color, vec3(0.55, 0.82, 1.0), vStream * 0.7);
  color = mix(color, vec3(0.18, 0.48, 1.0), uVoiceInput * 0.82);
  outColor = vec4(color, alpha);
}`;

function modeFor(state: BurnerState) {
  if (state === 'listening') return 1;
  if (state === 'hearing') return 1.4;
  if (state === 'speaking') return 2;
  if (state === 'muted') return 0.15;
  return 0;
}

function drawFallback(ctx: CanvasRenderingContext2D) {
  const center = 64;
  ctx.clearRect(0, 0, 128, 128);
  const metal = ctx.createRadialGradient(48, 42, 4, center, center, 59);
  metal.addColorStop(0, '#625a50');
  metal.addColorStop(1, '#211f1d');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(center, center, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#171615';
  ctx.beginPath();
  ctx.arc(center, center, 43, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#81786d';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (Math.PI / 2) * i;
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(angle) * 16, center + Math.sin(angle) * 16);
    ctx.lineTo(center + Math.cos(angle) * 40, center + Math.sin(angle) * 40);
    ctx.stroke();
  }
  ctx.fillStyle = '#4d463e';
  ctx.beginPath();
  ctx.arc(center, center, 26, 0, Math.PI * 2);
  ctx.fill();
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create the burner shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Unable to compile the burner shader: ${message ?? 'unknown shader error'}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the burner renderer.');
  const vertexObject = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentObject = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexObject);
  gl.attachShader(program, fragmentObject);
  gl.linkProgram(program);
  gl.deleteShader(vertexObject);
  gl.deleteShader(fragmentObject);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Unable to link the burner renderer: ${message ?? 'unknown program error'}`);
  }
  return program;
}

/** A ray-marched, interactive burner mark with voice-reactive flame and embers. */
export function GusteauIcon({
  size = 36,
  className,
  label,
  style,
  state = 'idle',
  level = 0,
  debugInteractive = false,
}: GusteauIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const stateRef = useRef<BurnerState>(state);
  const debugRef = useRef(debugInteractive);
  const redrawRef = useRef<() => void>(() => {});
  const [debugState, setDebugState] = useState<BurnerState | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const effectiveState = debugInteractive ? debugState ?? state : state;
  levelRef.current = level;
  stateRef.current = effectiveState;
  debugRef.current = debugInteractive;

  useEffect(() => {
    if (!debugInteractive) setDebugState(null);
  }, [debugInteractive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) {
      const fallback = canvas.getContext('2d');
      if (fallback) drawFallback(fallback);
      console.error('Gusteau’s 3D burner is unavailable: WebGL2 is not supported.');
      return;
    }
    const surface = canvas;
    const webgl = gl;

    let burnerProgram: WebGLProgram;
    let particleProgram: WebGLProgram;
    let particleBuffer: WebGLBuffer;
    try {
      burnerProgram = createProgram(gl, vertexShader, fragmentShader);
      particleProgram = createProgram(gl, particleVertexShader, particleFragmentShader);
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to create the burner particle buffer.');
      particleBuffer = buffer;
    } catch (error) {
      console.error('Gusteau’s 3D burner could not initialize.', error);
      return;
    }

    const particleCount = 42;
    const particles = new Float32Array(particleCount * 4);
    for (let i = 0; i < particleCount; i += 1) {
      const angle = (i % 7) * (Math.PI * 2 / 7) + Math.floor(i / 7) * 0.08;
      const seed = ((i / particleCount) + Math.floor(i / 7) * 0.61803398875) % 1;
      particles.set([angle, (i % 6) / 5, seed, (i * 0.754877666) % 1], i * 4);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);

    const burnerUniforms = {
      resolution: gl.getUniformLocation(burnerProgram, 'uResolution'),
      pointer: gl.getUniformLocation(burnerProgram, 'uPointer'),
      time: gl.getUniformLocation(burnerProgram, 'uTime'),
      mode: gl.getUniformLocation(burnerProgram, 'uMode'),
      level: gl.getUniformLocation(burnerProgram, 'uLevel'),
      ignition: gl.getUniformLocation(burnerProgram, 'uIgnition'),
      press: gl.getUniformLocation(burnerProgram, 'uPress'),
      voiceInput: gl.getUniformLocation(burnerProgram, 'uVoiceInput'),
    };
    const particleUniforms = {
      time: gl.getUniformLocation(particleProgram, 'uTime'),
      mode: gl.getUniformLocation(particleProgram, 'uMode'),
      ignition: gl.getUniformLocation(particleProgram, 'uIgnition'),
      pixelRatio: gl.getUniformLocation(particleProgram, 'uPixelRatio'),
      pointer: gl.getUniformLocation(particleProgram, 'uPointer'),
      voiceInput: gl.getUniformLocation(particleProgram, 'uVoiceInput'),
    };
    const particleAttribute = gl.getAttribLocation(particleProgram, 'aParticle');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let elapsed = 0;
    let previousFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let ignitionUntil = 0;
    let pressed = false;
    let press = 0;
    let pressVelocity = 0;
    let renderedState = stateRef.current;
    let visualMode = modeFor(renderedState);
    let transitionFromMode = visualMode;
    let transitionStart = 0;
    let visible = true;
    let dirty = true;

    const renderPixelRatio = () => Math.min(Math.max(window.devicePixelRatio || 1, 2) * 1.25, 4);
    const schedule = () => {
      if (!frame && visible && !document.hidden) frame = window.requestAnimationFrame(render);
    };
    const resize = () => {
      const ratio = renderPixelRatio();
      const width = Math.max(2, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(2, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      dirty = true;
      schedule();
    };
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      pointerY = -((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
      dirty = true;
      schedule();
    };
    const onPointerLeave = () => {
      pointerX = 0;
      pointerY = 0;
      dirty = true;
      schedule();
    };
    const onPointerDown = (event: PointerEvent) => {
      pressed = true;
      setIsPressed(true);
      canvas.setPointerCapture(event.pointerId);
      ignitionUntil = performance.now() + 720;
      dirty = true;
      schedule();
    };
    const onPointerUp = () => {
      pressed = false;
      setIsPressed(false);
      dirty = true;
      schedule();
    };
    const onVisibilityChange = () => {
      previousFrame = 0;
      if (!document.hidden) {
        dirty = true;
        schedule();
      }
    };
    const onMotionChange = () => {
      previousFrame = 0;
      dirty = true;
      schedule();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      console.error('Gusteau’s 3D burner lost its WebGL context.');
    };
    const onDebugClick = (event: MouseEvent) => {
      if (!debugRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const states: BurnerState[] = ['idle', 'listening', 'hearing', 'speaking', 'muted'];
      const currentIndex = states.indexOf(stateRef.current);
      setDebugState(states[(currentIndex + 1) % states.length]);
    };

    redrawRef.current = () => {
      dirty = true;
      schedule();
    };

    function render(timestamp: number) {
      frame = 0;
      if (!visible || document.hidden) return;
      const currentState = stateRef.current;
      if (currentState !== renderedState) {
        renderedState = currentState;
        transitionFromMode = visualMode;
        transitionStart = timestamp;
      }
      const transitionDuration = 420;
      const transitionProgress = reducedMotion.matches
        ? 1
        : Math.min((timestamp - transitionStart) / transitionDuration, 1);
      const easedProgress = transitionProgress * transitionProgress * (3 - 2 * transitionProgress);
      visualMode = reducedMotion.matches
        ? modeFor(currentState)
        : transitionFromMode + (modeFor(currentState) - transitionFromMode) * easedProgress;
      const transitioning = !reducedMotion.matches && transitionStart > 0 && transitionProgress < 1;
      const animated = !reducedMotion.matches && (
        currentState === 'muted' ||
        currentState === 'listening' ||
        currentState === 'hearing' ||
        currentState === 'speaking' ||
        transitioning ||
        timestamp < ignitionUntil ||
        pressed ||
        press > 0.001 ||
        Math.abs(pressVelocity) > 0.01
      );
      const delta = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.05) : 1 / 60;
      if (!dirty && !animated) return;
      elapsed += delta;
      previousFrame = timestamp;
      dirty = false;
      if (reducedMotion.matches) {
        press = pressed ? 1 : 0;
        pressVelocity = 0;
      } else {
        pressVelocity += (pressed ? 1 : 0) * 220 * delta - press * 220 * delta - pressVelocity * 25 * delta;
        press = Math.max(0, Math.min(1, press + pressVelocity * delta));
        if (!pressed && press < 0.001 && Math.abs(pressVelocity) < 0.01) {
          press = 0;
          pressVelocity = 0;
        }
      }

      const ratio = renderPixelRatio();
      const width = Math.max(2, Math.round(surface.clientWidth * ratio));
      const height = Math.max(2, Math.round(surface.clientHeight * ratio));
      if (surface.width !== width || surface.height !== height) {
        surface.width = width;
        surface.height = height;
      }

      const mode = visualMode;
      const ignition = timestamp < ignitionUntil ? 1 - (1 - (ignitionUntil - timestamp) / 720) ** 2 : 0;
      webgl.viewport(0, 0, width, height);
      webgl.clearColor(0, 0, 0, 0);
      webgl.clear(webgl.COLOR_BUFFER_BIT | webgl.DEPTH_BUFFER_BIT);
      webgl.disable(webgl.DEPTH_TEST);
      webgl.useProgram(burnerProgram);
      webgl.uniform2f(burnerUniforms.resolution, width, height);
      webgl.uniform2f(burnerUniforms.pointer, pointerX, pointerY);
      webgl.uniform1f(burnerUniforms.time, elapsed);
      webgl.uniform1f(burnerUniforms.mode, mode);
      webgl.uniform1f(burnerUniforms.level, levelRef.current);
      webgl.uniform1f(burnerUniforms.ignition, ignition);
      webgl.uniform1f(burnerUniforms.press, press);
      webgl.uniform1f(burnerUniforms.voiceInput, currentState === 'hearing' || (currentState === 'listening' && levelRef.current > 0.18) ? 1 : 0);
      webgl.drawArrays(webgl.TRIANGLES, 0, 3);

      if (mode >= 0.5 || ignition > 0.01) {
        webgl.enable(webgl.BLEND);
        webgl.blendFunc(webgl.SRC_ALPHA, webgl.ONE);
        webgl.useProgram(particleProgram);
        webgl.bindBuffer(webgl.ARRAY_BUFFER, particleBuffer);
        webgl.enableVertexAttribArray(particleAttribute);
        webgl.vertexAttribPointer(particleAttribute, 4, webgl.FLOAT, false, 0, 0);
        webgl.uniform1f(particleUniforms.time, elapsed);
        webgl.uniform1f(particleUniforms.mode, mode);
        webgl.uniform1f(particleUniforms.ignition, ignition);
        webgl.uniform1f(particleUniforms.pixelRatio, ratio);
        webgl.uniform2f(particleUniforms.pointer, pointerX, pointerY);
        webgl.uniform1f(particleUniforms.voiceInput, currentState === 'hearing' || (currentState === 'listening' && levelRef.current > 0.18) ? 1 : 0);
        webgl.drawArrays(webgl.POINTS, 0, particleCount);
        webgl.disable(webgl.BLEND);
      }

      if (animated) schedule();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        dirty = true;
        schedule();
      } else if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    intersectionObserver.observe(canvas);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('click', onDebugClick);
    canvas.addEventListener('webglcontextlost', onContextLost);
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onMotionChange);
    resize();

    return () => {
      redrawRef.current = () => {};
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('click', onDebugClick);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onMotionChange);
      gl.deleteBuffer(particleBuffer);
      gl.deleteProgram(burnerProgram);
      gl.deleteProgram(particleProgram);
    };
  }, []);

  useEffect(() => {
    redrawRef.current();
  }, [level, effectiveState]);

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-2xl bg-[#302c27] shadow-lift [filter:drop-shadow(0_7px_7px_rgba(39,29,20,0.28))] transition-[transform,filter] duration-100',
        'relative z-10 isolate overflow-visible',
        isPressed && 'translate-y-0.5 [filter:drop-shadow(0_2px_2px_rgba(39,29,20,0.3))]',
        className,
      )}
      style={{ width: size, height: size, ...style }}
    >
      <canvas
        ref={canvasRef}
        width={128}
        height={128}
        className={cx('absolute left-[-20%] top-[-20%] z-10 h-[140%] w-[140%] max-w-none', debugInteractive && 'cursor-pointer')}
        title={debugInteractive ? `Debug burner: ${effectiveState}. Click to cycle states.` : undefined}
        aria-label={debugInteractive ? `Debug burner state: ${effectiveState}. Click to cycle.` : undefined}
        aria-hidden
      />
    </span>
  );
}
