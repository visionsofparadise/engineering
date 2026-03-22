const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vTexCoord;
void main() {
	vTexCoord = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vTexCoord;
out vec4 fragColor;
uniform sampler2D uMagnitude;
uniform sampler2D uColormap;
uniform float uDbMin;
uniform float uDbMax;

void main() {
	float mag = texture(uMagnitude, vec2(vTexCoord.y, vTexCoord.x)).r;
	float db = mag > 0.0 ? 20.0 * log(mag) / log(10.0) : uDbMin;
	float normalized = clamp((db - uDbMin) / (uDbMax - uDbMin), 0.0, 1.0);
	vec3 color = texture(uColormap, vec2(normalized, 0.5)).rgb;
	fragColor = vec4(color, 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)!;

	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);

		gl.deleteShader(shader);
		throw new Error(`Shader compile error: ${info}`);
	}

	return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

	const program = gl.createProgram();

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(program);

		gl.deleteProgram(program);
		throw new Error(`Program link error: ${info}`);
	}

	return program;
}

export function generateColormapTexture(colorFn: (n: number) => readonly [number, number, number]): Uint8Array {
	const data = new Uint8Array(256 * 4);

	for (let index = 0; index < 256; index++) {
		const [red, green, blue] = colorFn(index / 255);

		data[index * 4] = red;
		data[index * 4 + 1] = green;
		data[index * 4 + 2] = blue;
		data[index * 4 + 3] = 255;
	}

	return data;
}

export class SpectrogramRenderer {
	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private magnitudeTexture: WebGLTexture;
	private colormapTexture: WebGLTexture;
	private vao: WebGLVertexArrayObject;
	private positionBuffer: WebGLBuffer;
	private canvas: OffscreenCanvas;
	private uMagnitude: WebGLUniformLocation;
	private uColormap: WebGLUniformLocation;
	private uDbMin: WebGLUniformLocation;
	private uDbMax: WebGLUniformLocation;

	constructor() {
		this.canvas = new OffscreenCanvas(1, 1);
		const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: false });

		if (!gl) throw new Error("WebGL2 not available");
		gl.getExtension("OES_texture_float_linear");
		this.gl = gl;

		this.program = createProgram(gl);

		this.positionBuffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);

		const posLoc = gl.getAttribLocation(this.program, "aPosition");

		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

		this.magnitudeTexture = gl.createTexture();

		this.colormapTexture = gl.createTexture();

		this.uMagnitude = gl.getUniformLocation(this.program, "uMagnitude")!;
		this.uColormap = gl.getUniformLocation(this.program, "uColormap")!;
		this.uDbMin = gl.getUniformLocation(this.program, "uDbMin")!;
		this.uDbMax = gl.getUniformLocation(this.program, "uDbMax")!;
	}

	uploadColormap(data: Uint8Array): void {
		const { gl } = this;

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	render(
		data: Float32Array,
		numFrames: number,
		numBins: number,
		dbRange: readonly [number, number],
		targetCanvas: HTMLCanvasElement,
		targetX: number,
		targetWidth: number,
		targetHeight: number,
	): void {
		const { gl } = this;

		if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
			this.canvas.width = targetWidth;
			this.canvas.height = targetHeight;
		}

		gl.viewport(0, 0, targetWidth, targetHeight);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.magnitudeTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, numBins, numFrames, 0, gl.RED, gl.FLOAT, data);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		gl.useProgram(this.program);
		gl.uniform1i(this.uMagnitude, 0);
		gl.uniform1i(this.uColormap, 1);
		gl.uniform1f(this.uDbMin, dbRange[0]);
		gl.uniform1f(this.uDbMax, dbRange[1]);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

		gl.bindVertexArray(this.vao);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		const canvasContext = targetCanvas.getContext("2d");

		if (!canvasContext) return;

		canvasContext.drawImage(this.canvas, 0, 0, targetWidth, targetHeight, targetX, 0, targetWidth, targetHeight);
	}

	dispose(): void {
		const { gl } = this;

		gl.deleteTexture(this.magnitudeTexture);
		gl.deleteTexture(this.colormapTexture);
		gl.deleteBuffer(this.positionBuffer);
		gl.deleteVertexArray(this.vao);
		gl.deleteProgram(this.program);
	}
}
