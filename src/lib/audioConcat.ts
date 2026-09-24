/**
 * Decodes multiple base64 WAV data URLs into AudioBuffers,
 * concatenates them in order, and re-encodes as a single WAV blob.
 */

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const pureB64 = base64.split(',')[1] ?? base64;
  const binaryString = atob(pureB64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function decodeAudioData(
  ctx: AudioContext | OfflineAudioContext,
  dataUrl: string
): Promise<AudioBuffer> {
  const arrayBuffer = base64ToArrayBuffer(dataUrl);
  return await ctx.decodeAudioData(arrayBuffer);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channel data
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export async function concatAudioDataUrls(
  dataUrls: string[]
): Promise<string> {
  if (dataUrls.length === 0) return '';
  if (dataUrls.length === 1) return dataUrls[0];

  // Use a temporary AudioContext for decoding
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const tempCtx = new AudioCtx();

  // Decode all audio data URLs
  const buffers: AudioBuffer[] = [];
  for (const url of dataUrls) {
    try {
      const buf = await decodeAudioData(tempCtx, url);
      buffers.push(buf);
    } catch {
      // Skip chunks that fail to decode
      console.warn('Failed to decode audio chunk, skipping');
    }
  }

  tempCtx.close();

  if (buffers.length === 0) throw new Error('Failed to decode any audio chunks');
  if (buffers.length === 1) {
    const blob = audioBufferToWav(buffers[0]);
    return await blobToDataUrl(blob);
  }

  // Determine the common format
  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map((b) => b.numberOfChannels));

  // Calculate total length
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);

  // Create offline context to render the combined buffer
  const offlineCtx = new OfflineAudioContext(numChannels, totalLength, sampleRate);

  // Write each buffer sequentially
  let offsetFrame = 0;
  for (const buf of buffers) {
    const source = offlineCtx.createBufferSource();
    // If channel count differs, create a new buffer with correct channels
    if (buf.numberOfChannels === numChannels) {
      source.buffer = buf;
    } else {
      const adapted = offlineCtx.createBuffer(numChannels, buf.length, buf.sampleRate);
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = adapted.getChannelData(ch);
        if (ch < buf.numberOfChannels) {
          channelData.set(buf.getChannelData(ch));
        } else {
          // Copy from first channel if missing
          channelData.set(buf.getChannelData(0));
        }
      }
      source.buffer = adapted;
    }
    source.connect(offlineCtx.destination);
    source.start(offsetFrame / sampleRate);
    offsetFrame += buf.length;
  }

  const rendered = await offlineCtx.startRendering();
  const blob = audioBufferToWav(rendered);
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
