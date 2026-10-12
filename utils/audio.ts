// Declare the lamejs object from the global scope (loaded via script tag)
declare const lamejs: any;

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // The raw audio data from the API is 16-bit PCM.
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert 16-bit integer to floating point value between -1.0 and 1.0
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function encodeToMp3(audioBuffer: AudioBuffer): Blob {
  const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128); // 1 channel, 24000 sample rate, 128 kbps
  const pcmData = audioBuffer.getChannelData(0);
  const sampleBlockSize = 1152;

  const mp3Data: Int8Array[] = [];

  // Convert PCM float data to 16-bit integers
  const pcmDataInt16 = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    pcmDataInt16[i] = pcmData[i] * 32767;
  }

  for (let i = 0; i < pcmDataInt16.length; i += sampleBlockSize) {
    const sampleChunk = pcmDataInt16.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }
  }

  const mp3buf = mp3Encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}