import { useEffect, useRef } from "react";

export function AsciiCitrus() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const CHARS = " .,:+=*%#@";
    const CELL_PX = 72;
    const atlas = document.createElement("canvas");
    atlas.width = CELL_PX * CHARS.length;
    atlas.height = CELL_PX * 2;
    const actx = atlas.getContext("2d");
    if (!actx) return;
    actx.fillStyle = "#000";
    actx.fillRect(0, 0, atlas.width, atlas.height);
    actx.fillStyle = "#fff";
    actx.font = `600 ${Math.floor(CELL_PX * 1.5)}px "JetBrains Mono", "Menlo", "Courier New", monospace`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    for (let i = 0; i < CHARS.length; i++) {
      actx.fillText(CHARS[i], i * CELL_PX + CELL_PX / 2, CELL_PX);
    }

    const atlasTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const vsSrc = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const fsSrc = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uTime;
uniform float uClick;
uniform float uYawKick;
uniform vec2 uCell;
uniform float uNumChars;
uniform sampler2D uAtlas;

const float PI = 3.14159265;
const float COIN_R = 0.82;
const float COIN_HALF_THICK = 0.09;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Ray from origin at angle alpha, clipped to maxR radius.
float rayLine(vec2 p, float alpha, float maxR, float thick) {
  float r = length(p);
  float theta = atan(p.y, p.x);
  float perp = r * abs(sin(theta - alpha));
  float along = r * cos(theta - alpha);
  return smoothstep(thick, 0.0, perp)
       * step(0.0, along)
       * smoothstep(maxR + 0.01, maxR - 0.01, r);
}

// Arc + flat-edge outline of a D-shape at radius R with given stroke.
float dOutline(vec2 p, float r, float R, float stroke, float inHalf) {
  float arc = smoothstep(stroke, 0.0, abs(r - R)) * inHalf;
  float edge = smoothstep(stroke, 0.0, abs(p.y))
             * smoothstep(R + 0.02, R - 0.02, abs(p.x));
  return max(arc, edge);
}

// 2D SDF of the Lucide citrus slice: outer D outline + inner D outline + 3
// wedge rays from the hinge (origin in this frame) to the inner arc.
// In this local frame, the flat edge is the x-axis and the slice fills y < 0.
float slice(vec2 p) {
  float r = length(p);
  float inHalf = smoothstep(0.015, -0.015, p.y); // soft half-plane mask

  float OUT_R = 0.82;
  float IN_R  = 0.58;
  float STROKE = 0.032;
  float STROKE_IN = 0.026;

  float outerD = dOutline(p, r, OUT_R, STROKE, inHalf);
  float innerD = dOutline(p, r, IN_R,  STROKE_IN, inHalf);

  // three wedge rays from the hinge (origin) to the inner arc
  float wedges = 0.0;
  wedges = max(wedges, rayLine(p, -PI * 0.25, IN_R, STROKE_IN * 0.85));
  wedges = max(wedges, rayLine(p, -PI * 0.50, IN_R, STROKE_IN * 0.85));
  wedges = max(wedges, rayLine(p, -PI * 0.75, IN_R, STROKE_IN * 0.85));

  return clamp(max(max(outerD, innerD), wedges), 0.0, 1.0);
}

mat3 rotX_m(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0,
              0.0, c,   s,
              0.0, -s,  c);
}

mat3 rotZ_m(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c,   s,   0.0,
              -s,  c,   0.0,
              0.0, 0.0, 1.0);
}

// 3D SDF: half-disk in xy extruded along z (a coin-like slice with real
// thickness). Flat edge at y=0, disk fills y<0, z in [-halfThick, +halfThick].
float sdSliceCoin(vec3 p, float R, float halfThick) {
  float dDisk = length(p.xy) - R;
  float dHalf = p.y;
  float d2d   = max(dDisk, dHalf);
  vec2 d = vec2(d2d, abs(p.z) - halfThick);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdCoin(vec3 p) {
  return sdSliceCoin(p, COIN_R, COIN_HALF_THICK);
}

vec3 calcNormal(vec3 p) {
  const float h = 0.0015;
  return normalize(vec3(
    sdCoin(p + vec3(h, 0, 0)) - sdCoin(p - vec3(h, 0, 0)),
    sdCoin(p + vec3(0, h, 0)) - sdCoin(p - vec3(0, h, 0)),
    sdCoin(p + vec3(0, 0, h)) - sdCoin(p - vec3(0, 0, h))
  ));
}

vec2 march(vec3 ro, vec3 rd) {
  float t = 1.5;
  for (int i = 0; i < 48; i++) {
    vec3 q = ro + rd * t;
    float d = sdCoin(q);
    if (d < 0.0012) return vec2(t, 1.0);
    if (t > 5.5) break;
    t += max(d * 0.9, 0.004);
  }
  return vec2(t, 0.0);
}

// Returns luminance [0..1] for the slice at this screen UV.
float shade(vec2 uv) {
  // Normalize so the smaller screen dimension maps to [-1, +1].
  float minDim = min(uResolution.x, uResolution.y);
  vec2 p = (uv * uResolution - uResolution * 0.5) / (minDim * 0.5);

  // Orthographic camera at +z looking -z.
  vec3 ro = vec3(p, 3.0);
  vec3 rd = vec3(0.0, 0.0, -1.0);

  // Auto-flip on pitch axis (around x). Yaw (around z) is mouse + click kick.
  // Base +45° rotation bakes in the logo orientation so the flat edge lies
  // on the diagonal when pitch and yaw are zero.
  float pitch = uTime * 0.32 + (uMouse.y - 0.5) * 1.0;
  float yaw   = (uMouse.x - 0.5) * 2.6 + uYawKick;

  mat3 Rt = rotZ_m(-(yaw + PI * 0.25)) * rotX_m(-pitch);

  vec3 roO = Rt * ro;
  vec3 rdO = Rt * rd;

  vec2 hit = march(roO, rdO);
  if (hit.y < 0.5) return 0.0;

  vec3 hp = roO + rdO * hit.x;
  vec3 n  = calcNormal(hp);

  // World-space light, rotated into object space
  vec3 lightW = normalize(vec3(-0.55, 0.85, 0.55));
  vec3 lightO = Rt * lightW;
  vec3 viewO  = -rdO;

  float diff = max(0.0, dot(n, lightO));
  float spec = pow(max(0.0, dot(n, normalize(lightO + viewO))), 28.0);
  float rim  = pow(1.0 - max(0.0, dot(n, viewO)), 2.6);
  float amb  = 0.05;

  float lum = amb + diff * 0.45 + spec * 0.30 + rim * 0.22;

  // If we hit the top or bottom face, paint the logo strokes onto it.
  float onFace = smoothstep(0.55, 0.95, abs(n.z));
  vec2 faceCoord = hp.xy * 1.06;
  float detail = slice(faceCoord);
  lum += onFace * detail * 0.80;

  // Pulp speckle when face-on
  vec2 cellQ = floor(faceCoord * 26.0) + floor(uTime * 1.6);
  float pulp = hash12(cellQ);
  float insideInner = smoothstep(0.58, 0.50, length(faceCoord))
                    * smoothstep(0.015, -0.015, faceCoord.y)
                    * onFace;
  lum += insideInner * step(0.93, pulp) * 0.40;

  // Click flash
  lum *= 1.0 + uClick * 0.35;

  return clamp(lum, 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cellOrigin = floor(frag / uCell) * uCell;
  vec2 cellCenter = cellOrigin + uCell * 0.5;
  vec2 sampleUV = cellCenter / uResolution;

  float lum = shade(sampleUV);

  float idx = floor(clamp(lum, 0.0, 0.9999) * uNumChars);

  vec2 localUV = (frag - cellOrigin) / uCell;
  float pad = 0.04;
  float gx = mix(pad, 1.0 - pad, localUV.x);
  float gy = mix(pad, 1.0 - pad, localUV.y);
  float atlasX = (idx + gx) / uNumChars;
  float atlasY = 1.0 - gy;
  float g = texture(uAtlas, vec2(atlasX, atlasY)).r;

  vec3 lime = vec3(0.87, 1.0, 0.0);
  vec3 deep = vec3(0.12, 0.22, 0.02);
  vec3 color = mix(deep, lime, pow(lum, 0.7)) * g;

  // Click tint pulse
  color += lime * uClick * 0.14 * g;

  // Vignette
  vec2 vuv = frag / uResolution - 0.5;
  float vign = 1.0 - dot(vuv, vuv) * 0.85;
  color *= clamp(vign, 0.0, 1.0);

  // Faint scanlines
  color *= 0.96 + 0.04 * sin(frag.y * 0.4);

  vec3 bg = vec3(0.005, 0.010, 0.0);
  color = max(color, bg);

  fragColor = vec4(color, 1.0);
}`;

    function compile(src: string, type: number) {
      if (!gl) return null;

      const sh = gl.createShader(type);
      if (!sh) return null;

      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("shader compile", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }

      return sh;
    }

    const vs = compile(vsSrc, gl.VERTEX_SHADER);
    const fs = compile(fsSrc, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("link", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uResolution");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uClick = gl.getUniformLocation(prog, "uClick");
    const uYawKick = gl.getUniformLocation(prog, "uYawKick");
    const uCell = gl.getUniformLocation(prog, "uCell");
    const uNum = gl.getUniformLocation(prog, "uNumChars");
    const uAtlas = gl.getUniformLocation(prog, "uAtlas");
    gl.uniform1i(uAtlas, 0);
    gl.uniform1f(uNum, CHARS.length);

    const state = {
      mx: 0.5,
      my: 0.5,
      tmx: 0.5,
      tmy: 0.5,
      clickAt: -10,
      yawKick: 0,
      yawVel: 0,
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      state.tmx = (e.clientX - rect.left) / rect.width;
      state.tmy = 1 - (e.clientY - rect.top) / rect.height;
    };
    const onLeave = () => {
      state.tmx = 0.5;
      state.tmy = 0.5;
    };
    const onClick = () => {
      state.clickAt = performance.now();
      state.yawVel += 4.5;
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onClick);

    const start = performance.now();
    let raf = 0;
    let lastFrame = start;
    let running = true;

    const render = () => {
      if (!running) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const t = (now - start) / 1000;

      state.mx += (state.tmx - state.mx) * 0.09;
      state.my += (state.tmy - state.my) * 0.09;

      // yaw kick: click adds angular velocity, which decays and
      // integrates into an extra yaw rotation the shader reads.
      state.yawKick += state.yawVel * dt;
      state.yawVel *= 0.5 ** (dt / 0.35);

      const click = Math.max(0, 1 - (now - state.clickAt) / 900);

      const cellW = Math.max(5, Math.round(6 * dpr));
      const cellH = cellW * 2;

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, state.mx, state.my);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uClick, click);
      gl.uniform1f(uYawKick, state.yawKick);
      gl.uniform2f(uCell, cellW, cellH);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onClick);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(atlasTex);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full cursor-crosshair"
      aria-hidden
    />
  );
}
