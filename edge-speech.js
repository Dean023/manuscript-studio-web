import {gecV2} from './edge-gec.js';

// Edge Read Aloud is an unofficial Microsoft endpoint. It may change or reject
// requests from some browser networks; keep the local Kokoro voices available.
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VERSION = '143.0.3650.75';
const ENDPOINT = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
const xml = value => String(value).replace(/[<>&"']/g, char => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));

export function synthesizeEdge(text, voice = 'en-US-JennyNeural', rate = '+0%') {
  if (voice !== 'en-US-JennyNeural') throw new Error('暂不支持该微软音色');
  if (!['-20%','-10%','+0%','+10%','+20%'].includes(rate)) throw new Error('朗读速度不支持');
  const id = crypto.randomUUID().replaceAll('-', '');
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    ConnectionId: id,
    'Ocp-Apim-Subscription-Key': TOKEN,
    'Sec-MS-GEC': gecV2(),
    'Sec-MS-GEC-Version': '2-' + VERSION,
  });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let ws, done = false;
    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      if (error) reject(error);
      else resolve(new Blob(chunks, {type:'audio/mpeg'}));
    };
    const timer = setTimeout(() => finish(new Error('Jenny 语音服务超时，请重试')), 90000);
    try {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => {
        const date = new Date().toString();
        ws.send(`X-Timestamp: ${date}\r\nContent-Type: application/json; charset=utf-8\r\nPath: speech.config\r\n\r\n` + JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:false,wordBoundaryEnabled:false},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}}));
        ws.send(`X-RequestId: ${id}\r\nContent-Type: application/ssml+xml\r\nX-Timestamp: ${date}\r\nPath: ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voice}"><prosody rate="${rate}" pitch="+0Hz" volume="+0%">${xml(text)}</prosody></voice></speak>`);
      });
      ws.addEventListener('message', event => {
        if (typeof event.data === 'string') {
          if (event.data.includes('Path:turn.end')) finish(chunks.length ? null : new Error('Jenny 没有返回音频，请重试'));
          return;
        }
        if (!(event.data instanceof ArrayBuffer)) return;
        const data = new Uint8Array(event.data);
        if (data.length < 2) return;
        const size = data[0] << 8 | data[1];
        if (size + 2 >= data.length) return;
        const header = new TextDecoder().decode(data.subarray(2, size + 2));
        if (header.includes('Path:audio')) chunks.push(data.slice(size + 2));
      });
      ws.addEventListener('error', () => finish(new Error('无法连接 Jenny 语音服务，请检查网络或使用本地版')));
      ws.addEventListener('close', () => { if (!done) finish(new Error('Jenny 语音连接提前关闭，请重试')); });
    } catch { finish(new Error('无法启动 Jenny 语音服务')); }
  });
}

export async function validateEdgeMp3(blob) {
  if (blob.size < 1024) throw new Error('Jenny 返回的 MP3 文件过小，已停止下载');
  const context = new AudioContext();
  try {
    const sound = await context.decodeAudioData(await blob.arrayBuffer());
    let peak = 0, energy = 0, count = 0;
    for (let channel = 0; channel < sound.numberOfChannels; channel++) {
      const samples = sound.getChannelData(channel);
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      count += samples.length;
    }
    if (!count || peak < 0.001 || Math.sqrt(energy / count) < 0.0001) {
      throw new Error('Jenny 返回了静音，已停止下载');
    }
  } finally {
    await context.close();
  }
}
