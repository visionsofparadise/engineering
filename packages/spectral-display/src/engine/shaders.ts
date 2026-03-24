export const FFT_PIPELINE_SHADER = /* wgsl */ `

override WORKGROUP_SIZE: u32;
override FFT_SIZE: u32;

struct Uniforms {
  fft_size: u32,
  chunk_offset: u32,
  num_bands: u32,
  use_band_mapping: u32,
  hop_size: u32,
}

@group(0) @binding(0) var<storage, read> input_samples: array<f32>;
@group(0) @binding(1) var<storage, read_write> magnitude_output: array<f32>;
@group(0) @binding(2) var<storage, read> band_mapping: array<f32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

var<workgroup> shared_re: array<f32, FFT_SIZE>;
var<workgroup> shared_im: array<f32, FFT_SIZE>;

fn bit_reverse(value: u32, bits: u32) -> u32 {
  var reversed: u32 = 0u;
  var remaining = value;
  for (var bit: u32 = 0u; bit < bits; bit = bit + 1u) {
    reversed = (reversed << 1u) | (remaining & 1u);
    remaining = remaining >> 1u;
  }
  return reversed;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(
  @builtin(workgroup_id) workgroup_id: vec3<u32>,
  @builtin(local_invocation_id) local_id: vec3<u32>,
) {
  let hop_index = workgroup_id.x;
  let thread_id = local_id.x;
  let fft_size = uniforms.fft_size;
  let half_fft = fft_size / 2u;
  let log2_fft = u32(log2(f32(fft_size)));
  let hop_size = uniforms.hop_size;
  let sample_base = hop_index * hop_size;

  // Load samples with bit-reversal permutation and Hann window
  let threads_per_load = WORKGROUP_SIZE;
  for (var offset: u32 = thread_id; offset < fft_size; offset = offset + threads_per_load) {
    let reversed = bit_reverse(offset, log2_fft);
    let sample_index = sample_base + offset;
    var sample_value: f32 = 0.0;
    if (sample_index < arrayLength(&input_samples)) {
      sample_value = input_samples[sample_index];
    }
    // Hann window
    let hann = 0.5 * (1.0 - cos(2.0 * 3.14159265358979323846 * f32(offset) / f32(fft_size - 1u)));
    shared_re[reversed] = sample_value * hann;
    shared_im[reversed] = 0.0;
  }

  workgroupBarrier();

  // Butterfly stages
  for (var stage: u32 = 0u; stage < log2_fft; stage = stage + 1u) {
    let block_size = 1u << (stage + 1u);
    let half_block = 1u << stage;

    for (var index: u32 = thread_id; index < half_fft; index = index + threads_per_load) {
      let block_index = index / half_block;
      let inner_index = index % half_block;
      let top = block_index * block_size + inner_index;
      let bottom = top + half_block;

      let angle = -2.0 * 3.14159265358979323846 * f32(inner_index) / f32(block_size);
      let twiddle_re = cos(angle);
      let twiddle_im = sin(angle);

      let bottom_re = shared_re[bottom] * twiddle_re - shared_im[bottom] * twiddle_im;
      let bottom_im = shared_re[bottom] * twiddle_im + shared_im[bottom] * twiddle_re;

      let top_re = shared_re[top];
      let top_im = shared_im[top];

      shared_re[top] = top_re + bottom_re;
      shared_im[top] = top_im + bottom_im;
      shared_re[bottom] = top_re - bottom_re;
      shared_im[bottom] = top_im - bottom_im;
    }

    workgroupBarrier();
  }

  // Compute magnitudes and write output
  let num_bins = half_fft + 1u;
  let scale_factor = 2.0 / f32(fft_size);
  let frame_index = uniforms.chunk_offset + hop_index;

  if (uniforms.use_band_mapping == 0u) {
    // Linear scale: write raw magnitudes
    for (var bin: u32 = thread_id; bin < num_bins; bin = bin + threads_per_load) {
      let re = shared_re[bin];
      let im = shared_im[bin];
      let magnitude = sqrt(re * re + im * im) * scale_factor;
      magnitude_output[frame_index * uniforms.num_bands + bin] = magnitude;
    }
  } else {
    // Non-linear scale: apply band mapping
    for (var band: u32 = thread_id; band < uniforms.num_bands; band = band + threads_per_load) {
      let mapping_offset = band * 4u;
      let bin_start = u32(band_mapping[mapping_offset]);
      let bin_end = u32(band_mapping[mapping_offset + 1u]);
      let weight_start = band_mapping[mapping_offset + 2u];
      let weight_end = band_mapping[mapping_offset + 3u];

      var accumulated: f32 = 0.0;
      for (var bin: u32 = bin_start; bin <= bin_end; bin = bin + 1u) {
        let re = shared_re[bin];
        let im = shared_im[bin];
        let magnitude = sqrt(re * re + im * im) * scale_factor;

        var weight: f32 = 1.0;
        if (bin == bin_start) {
          weight = weight_start;
        } else if (bin == bin_end) {
          weight = weight_end;
        }

        accumulated = accumulated + magnitude * weight;
      }

      var weight_sum: f32;
      if (bin_start == bin_end) {
        weight_sum = weight_start;
      } else {
        weight_sum = weight_start + weight_end + f32(bin_end - bin_start - 1u);
      }
      if (weight_sum > 0.0) {
        accumulated = accumulated / weight_sum;
      }
      magnitude_output[frame_index * uniforms.num_bands + band] = accumulated;
    }
  }
}
`;

export const SPECTROGRAM_VISUALIZE_SHADER = /* wgsl */ `

struct Uniforms {
  total_frames: u32,
  num_bands: u32,
  output_width: u32,
  output_height: u32,
  db_min: f32,
  db_max: f32,
}

@group(0) @binding(0) var<storage, read> magnitude_buffer: array<f32>;
@group(0) @binding(1) var<storage, read> colormap_buffer: array<u32>;
@group(0) @binding(2) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(64, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let column = global_id.x;
  let pixel_row = global_id.y;

  if (column >= uniforms.output_width || pixel_row >= uniforms.output_height) {
    return;
  }

  // Map pixel row to band with interpolation
  let band_float = f32(pixel_row) * f32(uniforms.num_bands - 1u) / f32(max(1u, uniforms.output_height - 1u));
  let band_low = u32(band_float);
  let band_high = min(band_low + 1u, uniforms.num_bands - 1u);
  let band_frac = band_float - f32(band_low);

  let stride = f32(uniforms.total_frames) / f32(uniforms.output_width);

  var max_magnitude: f32 = 0.0;

  if (stride >= 1.0) {
    let frame_start = u32(f32(column) * stride);
    let frame_end = min(u32(f32(column + 1u) * stride), uniforms.total_frames);

    var max_mag_low: f32 = 0.0;
    var max_mag_high: f32 = 0.0;

    for (var frame: u32 = frame_start; frame < frame_end; frame = frame + 1u) {
      max_mag_low = max(max_mag_low, magnitude_buffer[frame * uniforms.num_bands + band_low]);
      max_mag_high = max(max_mag_high, magnitude_buffer[frame * uniforms.num_bands + band_high]);
    }

    max_magnitude = max_mag_low * (1.0 - band_frac) + max_mag_high * band_frac;
  } else {
    let exact_frame = f32(column) * stride;
    let frame_low = min(u32(exact_frame), uniforms.total_frames - 1u);
    let frame_high = min(frame_low + 1u, uniforms.total_frames - 1u);
    let frame_frac = exact_frame - f32(frame_low);

    let mag_ll = magnitude_buffer[frame_low * uniforms.num_bands + band_low];
    let mag_lh = magnitude_buffer[frame_low * uniforms.num_bands + band_high];
    let mag_hl = magnitude_buffer[frame_high * uniforms.num_bands + band_low];
    let mag_hh = magnitude_buffer[frame_high * uniforms.num_bands + band_high];

    let mag_low_interp = mag_ll * (1.0 - frame_frac) + mag_hl * frame_frac;
    let mag_high_interp = mag_lh * (1.0 - frame_frac) + mag_hh * frame_frac;

    max_magnitude = mag_low_interp * (1.0 - band_frac) + mag_high_interp * band_frac;
  }

  // Convert to dB
  let db_value = 20.0 * log(max(max_magnitude, 1e-10)) / log(10.0);
  let db_range = uniforms.db_max - uniforms.db_min;
  let normalized = clamp((db_value - uniforms.db_min) / db_range, 0.0, 1.0);

  // Index into colormap (256 entries)
  let colormap_index = u32(normalized * 255.0);
  let packed = colormap_buffer[colormap_index];
  let red = f32(packed & 0xFFu) / 255.0;
  let green = f32((packed >> 8u) & 0xFFu) / 255.0;
  let blue = f32((packed >> 16u) & 0xFFu) / 255.0;
  let alpha = f32((packed >> 24u) & 0xFFu) / 255.0;

  let pixel_y = uniforms.output_height - 1u - pixel_row;
  textureStore(output_texture, vec2<i32>(i32(column), i32(pixel_y)), vec4<f32>(red, green, blue, alpha));
}
`;

export const WAVEFORM_VISUALIZE_SHADER = /* wgsl */ `

struct Uniforms {
  total_points: u32,
  output_width: u32,
  output_height: u32,
  waveform_color_r: f32,
  waveform_color_g: f32,
  waveform_color_b: f32,
}

@group(0) @binding(0) var<storage, read> waveform_buffer: array<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let column = global_id.x;

  if (column >= uniforms.output_width) {
    return;
  }

  let stride = f32(uniforms.total_points) / f32(uniforms.output_width);
  let point_start = min(u32(f32(column) * stride), uniforms.total_points - 1u);
  let point_end = max(point_start + 1u, min(u32(f32(column + 1u) * stride), uniforms.total_points));

  var min_val: f32 = 1.0;
  var max_val: f32 = -1.0;

  for (var point: u32 = point_start; point < point_end; point = point + 1u) {
    let min_sample = waveform_buffer[point * 2u];
    let max_sample = waveform_buffer[point * 2u + 1u];
    min_val = min(min_val, min_sample);
    max_val = max(max_val, max_sample);
  }

  let half_height = f32(uniforms.output_height) / 2.0;

  let y_min_pixel = u32(clamp(half_height - max_val * half_height, 0.0, f32(uniforms.output_height - 1u)));
  let y_max_pixel = u32(clamp(half_height - min_val * half_height, 0.0, f32(uniforms.output_height - 1u)));

  let color = vec4<f32>(
    uniforms.waveform_color_r / 255.0,
    uniforms.waveform_color_g / 255.0,
    uniforms.waveform_color_b / 255.0,
    1.0,
  );
  let transparent = vec4<f32>(0.0, 0.0, 0.0, 0.0);

  for (var pixel_y: u32 = 0u; pixel_y < uniforms.output_height; pixel_y = pixel_y + 1u) {
    if (pixel_y >= y_min_pixel && pixel_y <= y_max_pixel) {
      textureStore(output_texture, vec2<i32>(i32(column), i32(pixel_y)), color);
    } else {
      textureStore(output_texture, vec2<i32>(i32(column), i32(pixel_y)), transparent);
    }
  }
}
`;

export const BLIT_VERTEX_SHADER = /* wgsl */ `

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  // Fullscreen quad from two triangles using vertex_index
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );

  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
  output.uv = uvs[vertex_index];
  return output;
}
`;

export const BLIT_FRAGMENT_SHADER = /* wgsl */ `

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(source_texture, source_sampler, uv);
}
`;
