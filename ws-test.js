window.addEventListener('click', async e => {
  const ws = await new Promise((accept, reject) => {
    const ws = new WebSocket('wss://' + window.location.host);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      accept(ws);
    });
    ws.addEventListener('error', reject);
  });
  // console.log('got ws', ws);
  let lastMessage = null;
  ws.addEventListener('message', e => {
    // console.log('got message', e);
    if (typeof e.data === 'string') {
      lastMessage = e.data;
    } else {
      // console.log('got e', e.data, lastMessage);
      const j = JSON.parse(lastMessage);
      lastMessage = null;
      const {type, timestamp, duration} = j;
      const {data} = e;
      const encodedAudioChunk = new EncodedAudioChunk({
        type,
        timestamp,
        duration,
        data: e.data,
      });
      audioDecoder.decode(encodedAudioChunk);
    }
  });
  
  const channelCount = 1;
  const sampleRate = 48000;
  const bitrate = 60_000;
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount,
      sampleRate,
    },
  });
  const audioTracks = mediaStream.getAudioTracks();
  const audioTrack = audioTracks[0];
  // const audioTrackSettings = audioTrack.getSettings();
  const audio = (new MediaStreamTrackProcessor(audioTrack)).readable;
  // console.log('got media', audioTrack, audioTrack.getSettings(), audio);

  const audioEncoder = new AudioEncoder({
    output: muxAndSend,
    error: onEncoderError,
  });
  await audioEncoder.configure({
    codec: 'opus',
    numberOfChannels: channelCount,
    sampleRate,
    bitrate,
  });

  const audioDecoder = new AudioDecoder({
    output: demuxAndPlay,
    error: onDecoderError,
  });
  await audioDecoder.configure({
    codec: 'opus',
    numberOfChannels: channelCount,
    sampleRate,
  });  
  
  function muxAndSend(encodedChunk) {
    // console.log('got chunk', encodedChunk);
    const {type, timestamp, duration, byteLength} = encodedChunk;
    let data;
    if (encodedChunk.copyTo) { // new api
      data = new ArrayBuffer(byteLength);
      encodedChunk.copyTo(data);
    } else { // old api
      data = encodedChunk.data;
    }
    ws.send(JSON.stringify({
      type,
      timestamp,
      duration,
    }));
    ws.send(data);
  }
  function onEncoderError(err) {
    console.warn('encoder error', err);
  }
  async function readAndEncode(reader, encoder) {
    const result = await reader.read();
    if (!result.done) {
      encoder.encode(result.value);
      readAndEncode(reader, encoder);
    }
  }
  function demuxAndPlay(audioData) {
    // console.log('demux', audioData);
    let channelData;
    if (audioData.copyTo) { // new api
      channelData = new Float32Array(audioData.numberOfFrames);
      audioData.copyTo(channelData, {
        planeIndex: 0,
        frameCount: audioData.numberOfFrames,
      });
    } else { // old api
      channelData = audioData.buffer.getChannelData(0);
    }

    audioWorkletNode.port.postMessage(channelData, [channelData.buffer]);
  }
  function onDecoderError(err) {
    console.warn('decoder error', err);
  }
  
  readAndEncode(audio.getReader(), audioEncoder);

  const audioCtx = new AudioContext({
    latencyHint: 'interactive',
    sampleRate,
  });

  await audioCtx.audioWorklet.addModule('ws-worklet.js')
  const audioWorkletNode = new AudioWorkletNode(audioCtx, 'ws-worklet')
  audioWorkletNode.connect(audioCtx.destination);
  // console.log('lol', audioCtx.baseLatency);
  // console.log('worklet', audioWorkletNode);
});