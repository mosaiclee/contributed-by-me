const SAMPLE_RATE = 44100;
const DRUM_ATTACKS = {
  'djembe:B': ['tumba', .24],
  'djembe:T': ['quinto', .50],
  'djembe:S': ['rim', .58],
  'djembe:G': ['closedSlap', .36],
  'djembe:H': ['closedSlap', .56],
  'djembe:P': ['quinto', .12],
  'kenkeni:K': ['rim', .64],
  'sangban:K': ['rim', .61],
  'dundunba:K': ['rim', .58],
  'kenkeni:O': ['bongo', .39],
  'kenkeni:M': ['closedSlap', .34],
  'sangban:O': ['tumba', .34],
  'sangban:M': ['tumba', .28],
  'dundunba:O': ['taiko', .38],
  'dundunba:M': ['taiko', .30]
};
const SOUND_RECIPES = {
  'djembe:B': [87, .27, 11, .17, [1, 1.61, 2.14], [.94, .21, .11]],
  'djembe:T': [216, .19, 17, .20, [1, 1.51, 2.25], [.83, .38, .13]],
  'djembe:S': [380, .13, 29, .59, [1, 1.68, 3.09], [.40, .24, .15]],
  'djembe:G': [300, .07, 60, .27, [1, 2.01], [.31, .13]],
  'djembe:H': [530, .085, 42, .43, [1, 1.82, 2.73], [.33, .24, .16]],
  'djembe:P': [195, .062, 51, .12, [1, 1.55], [.17, .075]],
  'shekere:X': [760, .18, 34, .98, [1, 2.12, 3.3], [.11, .07, .03]],
  'kenkeni:O': [162, .21, 13, .19, [1, 1.64, 2.33], [.82, .26, .16]],
  'kenkeni:M': [155, .09, 38, .24, [1, 1.66, 2.35], [.73, .14, .06]],
  'sangban:O': [113, .26, 11, .22, [1, 1.52, 2.14], [.93, .30, .15]],
  'sangban:M': [107, .10, 32, .24, [1, 1.55, 2.18], [.80, .17, .07]],
  'dundunba:O': [60, .38, 8, .22, [1, 1.58, 2.28], [.98, .27, .19]],
  'dundunba:M': [58, .13, 28, .26, [1, 1.60, 2.3], [.83, .18, .08]],
  'kenkeni:K': [1120, .095, 56, .44, [1, 1.71, 2.85], [.48, .24, .12]],
  'sangban:K': [900, .105, 51, .43, [1, 1.76, 2.62], [.50, .23, .12]],
  'dundunba:K': [690, .12, 46, .41, [1, 1.79, 2.53], [.53, .22, .12]],
  'bell:X': [745, .20, 17, .18, [1, 1.67, 2.19, 2.87, 3.49], [.58, .33, .29, .14, .08]]
};

const BUILTIN_SOUND_PROFILES = {
  djembe: {
    rates: [.9935, .9978, 1.0022, 1.0065],
    strokes: {
      B: [[.018, .045], [.027, -.032], [.039, .027], [.053, -.02],
        [.068, .016], [.084, .012], [.107, -.009]]
    }
  }
};

function addRoomReflections(context, buffer, reflections) {
  const {sampleRate: rate} = buffer;
  const dry = buffer.getChannelData(0);
  const tail = Math.round(reflections.at(-1)[0] * rate);
  const shaped = context.createBuffer(1, dry.length + tail, rate);
  const output = shaped.getChannelData(0);
  output.set(dry);
  for (const [seconds, level] of reflections) {
    const delay = Math.round(seconds * rate);
    for (let i = 0; i < dry.length; i++) output[i + delay] += dry[i] * level;
  }
  return shaped;
}

function percussionBuffers(context) {
  const result = {};
  const recordings = globalThis.RHYTHM_DESK_RECORDINGS;
  for (const [key, recipe] of Object.entries(SOUND_RECIPES)) {
    const replacement = globalThis.RHYTHM_DESK_USER_RECORDINGS?.[key];
    if (replacement) {
      try {
        result[key] = decodedSample(context, replacement);
        continue;
      } catch (error) {
        console.warn('Could not load replacement percussion sample:', key, error);
      }
    }
    const recordedStroke = recordings?.[key];
    if (recordedStroke) {
      result[key] = decodedSample(context, recordedStroke);
      continue;
    }
    const [attackName, attackLevel] = DRUM_ATTACKS[key] ?? [];
    const recordedAttack = recordings?.[attackName];
    const attack = recordedAttack && decodedSample(context, recordedAttack).getChannelData(0);
    const [pitch, duration, decay, attackNoise, ratios, weights] = recipe;
    const length = Math.ceil(duration * context.sampleRate);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 54623;
    let filteredNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / context.sampleRate;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      filteredNoise = .55 * filteredNoise + .45 * noise;
      const phase = 2 * Math.PI * pitch * (t + .003 * (1 - Math.exp(-56 * t)));
      let body = 0;
      for (let part = 0; part < ratios.length; part++) {
        body += weights[part] * Math.sin(phase * ratios[part]) * Math.exp(-decay * (1 + .49 * part) * t);
      }
      const transient = (noise - .55 * filteredNoise) * attackNoise * Math.exp(-72 * t);
      const ramp = Math.min(1, i / 24, (length - i - 1) / 240);
      const frame = attack ? t * recordedAttack.rate : 0;
      const left = Math.floor(frame);
      const fraction = frame - left;
      const recorded = attack && left + 1 < attack.length
        ? (attack[left] * (1 - fraction) + attack[left + 1] * fraction) * attackLevel * Math.exp(-38 * t)
        : 0;
      samples[i] = .72 * Math.tanh(body + transient * (attack ? .55 : 1) + recorded) * ramp;
    }
    result[key] = buffer;
  }
  for (const type of PAIRED_DRUMS) {
    const key = type + ':X';
    const recording = globalThis.RHYTHM_DESK_USER_RECORDINGS?.[key];
    if (recording) result[key] = decodedSample(context, recording);
  }
  for (const [type, profile] of Object.entries(BUILTIN_SOUND_PROFILES)) {
    for (const [stroke, reflections] of Object.entries(profile.strokes)) {
      const key = type + ':' + stroke;
      result[key] = addRoomReflections(context, result[key], reflections);
    }
  }
  return result;
}

function makeMix(context) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.ratio.value = 8;
  compressor.attack.value = .004;
  compressor.release.value = .12;
  const output = context.createGain();
  output.gain.value = .9;
  const pan = context.createStereoPanner();
  compressor.connect(output).connect(pan).connect(context.destination);
  return { input: compressor, output, pan };
}

function makeChannel(context, mix) {
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  gain.connect(pan).connect(mix);
  return { gain, pan };
}

function applyMix(context, mix, channels, doc, ramp = false) {
  const tracks = doc.tracks;
  const apply = (parameter, value) => {
    if (ramp) parameter.setTargetAtTime(value, context.currentTime, .009);
    else {
      parameter.cancelScheduledValues(context.currentTime);
      parameter.setValueAtTime(value, context.currentTime);
    }
  };
  apply(mix.output.gain, .9 * doc.volume);
  apply(mix.pan.pan, doc.pan);
  const soloed = tracks.some(track => track.solo);
  for (const track of tracks) {
    const channel = channels.get(track.id);
    const level = track.mute || (soloed && !track.solo) ? 0 : track.volume;
    apply(channel.gain.gain, level);
    apply(channel.pan.pan, track.pan);
  }
}

function trigger(context, destination, buffers, track, stroke, when, doc) {
  const sample = customStrokeSample(track, stroke);
  const rates = sample ? null : BUILTIN_SOUND_PROFILES[track.type]?.rates;
  const source = context.createBufferSource();
  source.buffer = resolveStrokeBuffer(context, buffers, track, stroke, sample, doc);
  if (rates) source.playbackRate.value = rates[Math.floor(Math.random() * rates.length)];
  source.connect(destination);
  source.start(when);
  return source;
}

function parseSampleWav(bytes, fileName) {
  const view = new DataView(bytes);
  const tag = (offset, name) => Array.from(name).every((letter, index) => view.getUint8(offset + index) === letter.charCodeAt(0));
  const invalid = () => new Error(t('err.wavRead'));
  if (view.byteLength < 12 || !tag(0, 'RIFF') || !tag(8, 'WAVE')) throw invalid();
  const end = view.getUint32(4, true) + 8;
  if (end > view.byteLength) throw invalid();
  let format;
  let data;
  for (let offset = 12; offset + 8 <= end;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > end) throw invalid();
    if (tag(offset, 'fmt ') && !format) format = {start, size};
    if (tag(offset, 'data') && !data) data = {start, size};
    offset = start + size + (size & 1);
  }
  if (!format || !data || format.size < 16) throw invalid();
  const start = format.start;
  const encoding = view.getUint16(start, true);
  const channels = view.getUint16(start + 2, true);
  const rate = view.getUint32(start + 4, true);
  const align = view.getUint16(start + 12, true);
  const bits = view.getUint16(start + 14, true);
  const pcmGuid = [1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
  const extendedPCM = encoding === 0xfffe && format.size >= 40 &&
    view.getUint16(start + 16, true) >= 22 && view.getUint16(start + 18, true) === 16 &&
    pcmGuid.every((value, index) => value === view.getUint8(start + 24 + index));
  if ((encoding !== 1 && !extendedPCM) || bits !== 16 || ![1, 2].includes(channels) || align !== channels * 2) {
    throw new Error(t('err.wavFormat'));
  }
  if (!SAMPLE_RATES.includes(rate)) throw new Error(t('err.wavRate'));
  const frames = data.size / align;
  if (!validSampleFrames(rate, frames)) throw new Error(t('err.wavLength'));
  const mono = new Uint8Array(frames * 2);
  const output = new DataView(mono.buffer);
  for (let frame = 0; frame < frames; frame++) {
    const offset = data.start + frame * align;
    const left = view.getInt16(offset, true);
    const value = channels === 1 ? left : Math.round((left + view.getInt16(offset + 2, true)) / 2);
    output.setInt16(frame * 2, value, true);
  }
  let binary = '';
  for (let offset = 0; offset < mono.length; offset += 8192) {
    binary += String.fromCharCode(...mono.subarray(offset, offset + 8192));
  }
  return {name: shortText(fileName, 96, 'WAV 采样'), rate, pcm: btoa(binary)};
}

const sampleBufferCache = new WeakMap();
const alignedSampleBufferCache = new WeakMap();

function strokeBuffer(context, buffers, track, stroke, doc) {
  return resolveStrokeBuffer(context, buffers, track, stroke, customStrokeSample(track, stroke), doc);
}

function resolveStrokeBuffer(context, buffers, track, stroke, sample, doc) {
  if (sample) return decodedSample(context, sample, true);
  if (track.type === 'bell' && track.bellFor) {
    const drum = doc?.tracks.find(candidate => candidate.id === track.bellFor);
    const pairedBell = drum && buffers[drum.type + ':X'];
    if (pairedBell) return pairedBell;
  }
  return buffers[track.type + ':' + stroke];
}

function sampleAttackFrame(samples, rate) {
  const windowSize = Math.max(1, Math.round(rate / 1000));
  const energy = [];
  let peak = 0;
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let sum = 0;
    for (let frame = start; frame < end; frame++) sum += samples[frame] ** 2;
    const mean = sum / (end - start);
    energy.push(mean);
    peak = Math.max(peak, mean);
  }
  if (!peak) return 0;
  const threshold = peak * .04 ** 2;
  const first = energy.findIndex((mean, index) =>
    mean >= threshold && (mean >= 4 * threshold || energy[index + 1] >= threshold));
  if (first <= 0) return 0;
  const start = first * windowSize;
  const amplitude = Math.sqrt(threshold);
  let frame = start;
  while (frame < start + windowSize && frame < samples.length && Math.abs(samples[frame]) < amplitude) frame++;
  // Keep just enough of the leading edge for a sub-millisecond anti-click ramp.
  return Math.max(0, frame - Math.round(rate * .0004));
}

function decodedSample(context, sample, alignAttack = false) {
  const buffers = alignAttack ? alignedSampleBufferCache : sampleBufferCache;
  let cache = buffers.get(context);
  if (!cache) {
    cache = new WeakMap();
    buffers.set(context, cache);
  }
  if (!cache.has(sample)) {
    const pcm = atob(sample.pcm);
    const samples = new Int16Array(pcm.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = pcm.charCodeAt(i * 2) | (pcm.charCodeAt(i * 2 + 1) << 8);
    }
    const offset = alignAttack ? sampleAttackFrame(samples, sample.rate) : 0;
    const buffer = context.createBuffer(1, samples.length - offset, sample.rate);
    const data = buffer.getChannelData(0);
    const ramp = offset ? Math.max(1, Math.round(sample.rate * .0003)) : 1;
    for (let i = 0; i < data.length; i++) {
      const gain = offset ? Math.min(1, i / ramp) : 1;
      data[i] = gain * samples[offset + i] / 32768;
    }
    cache.set(sample, buffer);
  }
  return cache.get(sample);
}

function strike(context, destination, buffers, track, stroke, when, doc) {
  if (stroke.length === 1) return [trigger(context, destination, buffers, track, stroke, when, doc)];
  const graceGain = context.createGain();
  graceGain.gain.value = .45;
  graceGain.connect(destination);
  const grace = trigger(context, graceGain, buffers, track, stroke[0], when, doc);
  grace.onended = () => graceGain.disconnect();
  return [grace, trigger(context, destination, buffers, track, stroke[1], when + .025, doc)];
}

class PlaybackCursor {
  constructor(first, end, loops) {
    this.first = first;
    this.end = end;
    this.loops = loops;
    this.restart();
  }

  restart(step = this.first) {
    this.step = step;
    this.gates = this.loops.map(range => ({...range, released: false}));
    this.index = this.gates.findIndex(gate => gate.to > step);
    if (this.index < 0) this.index = this.gates.length;
  }

  get waitingAtBoundary() {
    const gate = this.gates[this.index];
    return gate && this.step === gate.to && !gate.released;
  }

  take() {
    const ending = this.gates[this.index];
    const loopReturn = Boolean(ending && this.step === ending.to && !ending.released);
    if (loopReturn) this.step = ending.from;
    else if (ending && this.step === ending.to) this.index++;
    if (this.step === this.end) return null;
    const gate = this.gates[this.index];
    const step = this.step++;
    return {step, gate: gate && step >= gate.from ? gate : null, loopReturn};
  }
}

// Group-clock motion is independent of subdivisions and silent notes. Keep the
// tempo anchors with each group so pruning the scheduler history cannot move it.
function groupClockProgress(group, now) {
  if (!group || !(group.lastTick > group.firstTick)) return 0;
  let i = group.tempos.length - 1;
  while (i > 0 && now < group.tempos[i].time) i--;
  const origin = group.tempos[i];
  const tick = origin.tick + (now - origin.time) * origin.bpm * TICKS_PER_PULSE / 60;
  return clamp((tick - group.firstTick) / (group.lastTick - group.firstTick), 0, 1);
}

class Transport {
  constructor(onStep, onError, onFinish) {
    this.onStep = onStep;
    this.onError = onError;
    this.onFinish = onFinish;
    this.sources = new Set();
    this.channels = new Map();
    this.lanes = [];
    this.tempos = [];
    this.generation = 0;
    this.running = false;
    this.paused = false;
  }

  async enableAudio() {
    if (!this.context || this.context.state === 'closed') {
      const AudioEngine = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      const context = new AudioEngine({latencyHint: 'interactive'});
      try {
        const buffers = percussionBuffers(context);
        const mix = makeMix(context);
        // Keep the output graph active between hits. Far below audible level;
        // avoids a silent/disconnected graph being put to sleep by WebView drivers.
        const idleBuffer = context.createBuffer(1, 128, context.sampleRate);
        const idleData = idleBuffer.getChannelData(0);
        for (let i = 0; i < idleData.length; i++) idleData[i] = i % 2 ? 1e-8 : -1e-8;
        const idleSource = context.createBufferSource();
        idleSource.buffer = idleBuffer; idleSource.loop = true;
        idleSource.connect(context.destination); idleSource.start();
        Object.assign(this, {context, buffers, mix, idleSource, needsWarmup: true});
      } catch (error) {
        context.close().catch(() => {});
        throw error;
      }
    }
    if (this.context.state !== 'running') { this.needsWarmup = true; await this.context.resume(); }
    if (this.context.state !== 'running') throw new Error('Audio output could not resume');
  }

  async readyOutput() {
    // Do not schedule musical notes against a clock that has not started rendering.
    if (this.outputReady) return this.outputReady;
    const context = this.context;
    const cold = this.needsWarmup || this.lastAudioUse === undefined || performance.now() - this.lastAudioUse > 15000;
    const settle = cold ? Math.min(2, Math.max(.25, (context.baseLatency || 0) + (context.outputLatency || 0) + .12)) : .025;
    this.outputReady = new Promise((resolve, reject) => {
      const start = context.currentTime, wall = performance.now();
      const poll = () => {
        if (context.state !== 'running') { reject(new Error('Audio output interrupted')); return; }
        const stamp = context.getOutputTimestamp?.();
        const output = stamp && stamp.contextTime > 0 ? stamp.contextTime : context.currentTime;
        if (context.currentTime - start >= settle && output >= start) { this.needsWarmup = false; resolve(); return; }
        if (performance.now() - wall > 3000) { reject(new Error('Audio output did not become ready')); return; }
        setTimeout(poll, 12);
      };
      poll();
    }).finally(() => { this.outputReady = null; this.lastAudioUse = performance.now(); });
    return this.outputReady;
  }

  async preview(track, stroke, doc) {
    await this.enableAudio();
    if (!this.running) await this.readyOutput();
    // Each audition owns its gain/pan, so changing tracks cannot alter a ringing hit.
    const channel = makeChannel(this.context, this.mix.input);
    const soloed = doc.tracks.some(item => item.solo);
    channel.gain.gain.value = track.mute || (soloed && !track.solo) ? 0 : (track.volume ?? 1);
    channel.pan.pan.value = track.pan ?? 0;
    if (!this.running) {
      for (const [parameter, value] of [[this.mix.output.gain, .9 * doc.volume], [this.mix.pan.pan, doc.pan]]) {
        parameter.cancelScheduledValues(this.context.currentTime);
        parameter.setValueAtTime(value, this.context.currentTime);
      }
    }
    const sources = strike(this.context, channel.gain, this.buffers, track, stroke, this.context.currentTime + .015, doc);
    let remaining = sources.length;
    for (const source of sources) source.addEventListener('ended', () => {
      if (--remaining === 0) { channel.gain.disconnect(); channel.pan.disconnect(); }
    }, {once: true});
    this.lastAudioUse = performance.now();
  }

  async start(doc, range, wrap, position) {
    this.stop();
    const generation = this.generation;
    await this.enableAudio();
    await this.readyOutput();
    if (generation !== this.generation) return false;
    this.doc = doc;
    this.wrap = wrap;
    const timings = doc.tracks.map(track => ({track, ...trackTiming(doc, track, true)}));
    const selected = timings.find(({track}) => track.id === position.track);
    const offset = selected ? selected.ticks[position.step] - selected.ticks[selected.barSteps[range?.from ?? 0]] : 0;
    for (const {track, ticks, barSteps, groups} of timings) {
      const lastBar = barSteps.length - 1;
      const first = barSteps[range?.from ?? 0];
      const end = barSteps[Math.min(range?.to ?? lastBar, lastBar)];
      if (first === undefined || first >= end) continue;
      // Decode imported hits before setting the shared audio clock, including the first beat.
      for (const stroke of TYPES[track.type].strokes) {
        if (stroke.length === 1) strokeBuffer(this.context, this.buffers, track, stroke, doc);
      }
      const loops = track.loops.map(({from, to}) => ({from: barSteps[from], to: barSteps[to]}))
        .filter(loop => loop.from >= first && loop.to <= end);
      const startTick = ticks[first] + offset;
      const next = ticks.findIndex((tick, step) => step >= first && step < end && tick >= startTick);
      const path = new PlaybackCursor(first, end, loops);
      path.restart(next < 0 ? end : next);
      const stepGroups = [];
      groups.forEach((group, index) => {
        const to = groups[index + 1]?.first ?? ticks.length - 1;
        for (let step = group.first; step < to; step++) stepGroups[step] = {from: group.first, to};
      });
      this.lanes.push({track, ticks, path, stepGroups,
        nextTick: next < 0 ? Math.max(0, ticks[end] - startTick) : ticks[next] - startTick,
        ended: false, queue: [], step: -1, gate: null});
    }
    if (!this.lanes.length) return false;
    this.lastAudioUse = performance.now();
    this.scheduledUntil = this.context.currentTime + .25 + Math.max(.055, this.context.baseLatency || 0);
    this.tempos = [{time: this.scheduledUntil, tick: 0, bpm: doc.bpm}];
    this.channels = new Map(doc.tracks.map(track => [track.id, makeChannel(this.context, this.mix.input)]));
    applyMix(this.context, this.mix, this.channels, doc);
    this.running = true;
    const pump = () => {
      try { this.schedule(); }
      catch (error) { this.stop(); this.onError(error); }
    };
    this.timer = setInterval(pump, 23);
    pump();
    const paint = () => {
      if (!this.running) return;
      if (!this.paused) this.advancePlayhead(this.context.currentTime);
      this.animation = requestAnimationFrame(paint);
    };
    if (this.running) this.animation = requestAnimationFrame(paint);
    return this.running;
  }

  setTempo(bpm) {
    if (!this.running) return;
    const previous = this.tempos.at(-1);
    if (previous.bpm === bpm) return;
    for (const lane of this.lanes) lane.ticks = trackTiming(this.doc, lane.track, true).ticks;
    // Change every lane together after the events already handed to the audio device.
    const time = Math.max(this.context.currentTime, this.scheduledUntil, previous.time);
    if (time === previous.time) {
      previous.bpm = bpm;
    } else {
      const tick = previous.tick + (time - previous.time) * previous.bpm * TICKS_PER_PULSE / 60;
      this.tempos.push({time, tick, bpm});
    }
    const origin = this.tempos.at(-1);
    for (const lane of this.lanes) {
      const clocks = new Set([lane.visualGroup, lane.scheduledGroup, ...lane.queue.map(event => event.group)]);
      for (const clock of clocks) {
        if (!clock) continue;
        const last = clock.tempos.at(-1);
        if (last.time === origin.time) Object.assign(last, origin);
        else clock.tempos.push({...origin});
      }
    }
  }

  timeAt(tick) {
    let index = this.tempos.length - 1;
    while (index > 0 && tick < this.tempos[index].tick) index--;
    const origin = this.tempos[index];
    return origin.time + playbackSeconds(tick - origin.tick, origin.bpm);
  }

  nextUnscheduledTick() {
    return Math.min(...this.lanes.map(lane => lane.ended ? Infinity : lane.nextTick));
  }

  scheduleLane(lane, now) {
    if (lane.ended) return;
    const {track, ticks, path, queue} = lane;
    const gain = this.channels.get(track.id).gain;
    for (let when = this.timeAt(lane.nextTick); when < now + .35; when = this.timeAt(lane.nextTick)) {
      // Decide near the loop boundary so a late release can still affect this pass.
      if (path.waitingAtBoundary && when > now + .12) return;
      const next = path.take();
      this.scheduledUntil = Math.max(this.scheduledUntil, when);
      if (!next) {
        lane.ended = true;
        queue.push({when, step: -1, gate: null});
        return;
      }
      const {step, gate} = next;
      const stroke = track.cells[step];
      if (stroke) {
        for (const source of strike(this.context, gain, this.buffers, track, stroke, when, this.doc)) {
          this.sources.add(source);
          source.addEventListener('ended', () => { this.sources.delete(source); source.disconnect(); }, { once: true });
        }
      }
      const span = lane.stepGroups?.[step] ?? {from: step, to: step + 1};
      const groupEnd = Math.min(span.to, path.end);
      if (!lane.scheduledGroup || lane.scheduledGroup.from !== span.from || next.loopReturn || lane.restarting) {
        lane.scheduledGroup = {from: span.from, to: groupEnd,
          firstTick: lane.nextTick + ticks[span.from] - ticks[step],
          lastTick: lane.nextTick + ticks[groupEnd] - ticks[step],
          tempos: this.tempos.map(origin => ({...origin}))};
      }
      lane.nextTick += ticks[step + 1] - ticks[step];
      queue.push({when, step, gate, group: lane.scheduledGroup,
        until: this.timeAt(lane.nextTick), loopReturn: next.loopReturn || lane.restarting});
      lane.restarting = false;
    }
  }

  schedule() {
    if (!this.running || this.paused) return;
    const now = this.context.currentTime;
    const nextAt = this.timeAt(this.nextUnscheduledTick());
    if (nextAt < now - .035 && this.scheduledUntil <= now) {
      const delay = now + .035 - nextAt;
      for (const tempo of this.tempos) tempo.time += delay;
    }
    for (const lane of this.lanes) this.scheduleLane(lane, now);
    if (this.lanes.every(lane => lane.ended)) {
      const lastTick = Math.max(...this.lanes.map(lane => lane.nextTick));
      if (this.wrap) {
        for (const lane of this.lanes) {
          lane.path.restart();
          lane.restarting = true;
          lane.nextTick = lastTick;
          lane.ended = false;
          this.scheduleLane(lane, now);
        }
      } else if (this.timeAt(lastTick) <= now && !this.sources.size) {
        // A stroke can outlast its score slot, especially after an off-beat paste.
        const finalPositions = new Map(this.lanes.map(lane => {
          let last = lane.path.end - 1;
          while (last > lane.path.first && !lane.track.cells[last]) last--;
          if (!lane.track.cells[last]) last = lane.path.end - 1;
          return [lane.track.id, last];
        }));
        this.stop();
        this.onFinish(finalPositions);
        return;
      }
    }
    // Lanes can be queued to different ticks, so keep tempo anchors they can still reach.
    const nextTick = this.nextUnscheduledTick();
    while (this.tempos.length > 1 && this.tempos[1].tick <= nextTick) this.tempos.shift();
  }

  advancePlayhead(now) {
    let changed = false;
    const playbackStarts = new Set();
    const jumps = new Map();
    for (const lane of this.lanes) {
      while (lane.queue[0]?.when <= now) {
        const {step, gate, when, until, loopReturn, group} = lane.queue.shift();
        if (step >= 0 && (loopReturn || lane.step < 0)) {
          playbackStarts.add(lane.track.id);
          jumps.set(lane.track.id, {step, loopReturn, loopFrom: loopReturn ? gate?.from ?? step : null});
        }
        lane.visualBeat = {when, until};
        lane.visualGroup = group;
        lane.step = step;
        lane.gate = gate;
        changed = true;
      }
    }
    if (changed) this.onStep(new Map(this.lanes.map(lane => [lane.track.id, lane.step])), this.currentGates(), playbackStarts, jumps);
  }

  playheadGroupMotion(trackId) {
    const lane = this.lanes.find(item => item.track.id === trackId);
    const group = lane?.visualGroup;
    if (!group || lane.step < 0) return null;
    return {from: group.from, to: group.to,
      loopEnd: Boolean(lane.gate && !lane.gate.released && group.to === lane.gate.to),
      progress: groupClockProgress(group, this.context.currentTime)};
  }

  playheadMotion(trackId) {
    const lane = this.lanes.find(item => item.track.id === trackId);
    const beat = lane?.visualBeat;
    if (!beat || lane.step < 0 || !(beat.until > beat.when)) return null;
    const next = lane.queue[0]?.step ?? (lane.gate && !lane.gate.released && lane.step + 1 === lane.gate.to
      ? lane.gate.from : lane.step + 1 < lane.path.end ? lane.step + 1 : -1);
    return {next, loopFrom: lane.gate && !lane.gate.released ? lane.gate.from : null, progress: clamp((this.context.currentTime - beat.when) / (beat.until - beat.when), 0, 1)};
  }

  currentGates() {
    return this.lanes.map(lane => lane.gate).filter(Boolean);
  }

  releaseLoop() {
    if (!this.running || this.paused) return false;
    this.advancePlayhead(this.context.currentTime);
    const gates = this.currentGates();
    for (const gate of gates) gate.released = true;
    return gates.length > 0;
  }

  async setPaused(paused) {
    const generation = this.generation;
    if (paused) {
      this.paused = true;
      await this.context.suspend();
    } else {
      // Keep the suspended clock and queued first hit intact during the lead-in.
      await new Promise(resolve => setTimeout(resolve, 250));
      if (generation !== this.generation) return;
      await this.context.resume();
      if (generation === this.generation) this.paused = false;
    }
  }

  refreshMix() {
    if (this.running) applyMix(this.context, this.mix, this.channels, this.doc, true);
  }

  stop() {
    this.generation++;
    this.running = false;
    this.paused = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.animation);
    for (const source of this.sources) source.stop();
    this.sources.clear();
    for (const { gain, pan } of this.channels.values()) { gain.disconnect(); pan.disconnect(); }
    this.channels.clear();
    this.lanes = [];
    this.tempos = [];
  }
}

async function exportBacking(doc, duration, format) {
  const parts = doc.tracks.map(track => ({track, ticks: trackTiming(doc, track, true).ticks}));
  const cycleTicks = Math.max(...parts.map(part => part.ticks.at(-1)));
  const cycleFrames = Math.round(playbackSeconds(cycleTicks, doc.bpm) * SAMPLE_RATE);
  const targetFrames = Math.round(duration * SAMPLE_RATE);
  const cycleCount = Math.min(2, Math.ceil(targetFrames / cycleFrames));
  const context = new OfflineAudioContext(2, Math.min(targetFrames, cycleCount * cycleFrames), SAMPLE_RATE);
  const buffers = percussionBuffers(context);
  const mix = makeMix(context);
  const channels = new Map(doc.tracks.map(track => [track.id, makeChannel(context, mix.input)]));
  applyMix(context, mix, channels, doc);
  for (let loop = 0; loop < cycleCount; loop++) {
    for (const {track, ticks} of parts) {
      const gain = channels.get(track.id).gain;
      track.cells.forEach((stroke, step) => {
        const time = loop * cycleFrames / SAMPLE_RATE + playbackSeconds(ticks[step], doc.bpm);
        if (stroke && time * SAMPLE_RATE < context.length) strike(context, gain, buffers, track, stroke, time, doc);
      });
    }
  }
  const buffer = await context.startRendering();
  return format === 'm4a' ? encodeM4A(buffer, targetFrames, cycleFrames) : assemblePCM(buffer, targetFrames, cycleFrames, format);
}

function assemblePCM(buffer, frames, cycleFrames, format) {
  const wave = format === 'wav';
  const bytes = frames * 4;
  const header = new DataView(new ArrayBuffer(wave ? 44 : 54));
  const word = (offset, value) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  if (wave) {
    word(0, 'RIFF'); header.setUint32(4, 36 + bytes, true);
    word(8, 'WAVE'); word(12, 'fmt '); header.setUint32(16, 16, true);
    header.setUint16(20, 1, true); header.setUint16(22, 2, true);
    header.setUint32(24, SAMPLE_RATE, true); header.setUint32(28, SAMPLE_RATE * 4, true);
    header.setUint16(32, 4, true); header.setUint16(34, 16, true);
    word(36, 'data'); header.setUint32(40, bytes, true);
  } else {
    word(0, 'FORM'); header.setUint32(4, 46 + bytes);
    word(8, 'AIFF'); word(12, 'COMM'); header.setUint32(16, 18);
    header.setUint16(20, 2); header.setUint32(22, frames); header.setUint16(26, 16);
    // 44,100 Hz encoded as an 80-bit IEEE extended float.
    header.setUint16(28, 0x400e); header.setUint32(30, 0xac440000);
    word(38, 'SSND'); header.setUint32(42, 8 + bytes);
  }
  const pcm = new DataView(new ArrayBuffer(buffer.length * 4));
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const encode = value => Math.round(clamp(value, -1, 1) * (value < 0 ? 32768 : 32767));
  for (let i = 0; i < buffer.length; i++) {
    pcm.setInt16(4 * i, encode(left[i]), wave);
    pcm.setInt16(4 * i + 2, encode(right[i]), wave);
  }
  const type = wave ? 'audio/wav' : 'audio/aiff';
  const data = new Blob([pcm.buffer]);
  const parts = [header.buffer, data];
  if (frames > buffer.length) {
    const cycle = data.slice(cycleFrames * 4);
    if (!cycle.size) throw new Error('缺少重复段的音频数据。');
    let remaining = (frames - buffer.length) * 4;
    while (remaining >= cycle.size) { parts.push(cycle); remaining -= cycle.size; }
    if (remaining) parts.push(cycle.slice(0, remaining));
  }
  return new Blob(parts, { type });
}

const AAC_CONFIG = {codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000, aac: {format: 'aac'}};
const AAC_FRAMES = 1024;

async function supportsM4A() {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try { return (await AudioEncoder.isConfigSupported(AAC_CONFIG)).supported; }
  catch { return false; }
}

async function encodeM4A(buffer, targetFrames, cycleFrames) {
  if (!await supportsM4A()) throw new Error('系统未提供 AAC 编码。');
  const packets = [];
  let config;
  let failure;
  const encoder = new AudioEncoder({
    error: error => { failure = error; },
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, timestamp: chunk.timestamp });
      const description = metadata?.decoderConfig?.description;
      if (description) {
        config = description instanceof ArrayBuffer
          ? new Uint8Array(description).slice()
          : new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice();
      }
    }
  });
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const samples = new Float32Array(2 * AAC_FRAMES);
  try {
    encoder.configure(AAC_CONFIG);
    for (let start = 0; start < targetFrames; start += AAC_FRAMES) {
      if (failure) throw failure;
      if (encoder.encodeQueueSize > 16) await new Promise(resolve => {
        // A failed encoder may close before delivering another dequeue event.
        const done = () => { clearTimeout(timer); encoder.removeEventListener('dequeue', done); resolve(); };
        const timer = setTimeout(done, 30);
        encoder.addEventListener('dequeue', done, {once: true});
      });
      for (let frame = 0; frame < AAC_FRAMES; frame++) {
        const position = start + frame;
        const source = position < buffer.length ? position : cycleFrames + (position - cycleFrames) % cycleFrames;
        samples[frame] = position < targetFrames ? left[source] : 0;
        samples[AAC_FRAMES + frame] = position < targetFrames ? right[source] : 0;
      }
      const data = new AudioData({format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: AAC_FRAMES,
        numberOfChannels: 2, timestamp: Math.round(start * 1000000 / SAMPLE_RATE), data: samples});
      try { encoder.encode(data); }
      finally { data.close(); }
    }
    await encoder.flush();
    if (failure) throw failure;
    if (!packets.length) throw new Error('AAC 编码未返回音频。');
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  const delay = clamp(Math.round(-packets[0].timestamp * SAMPLE_RATE / 1000000), 0, packets.length * AAC_FRAMES - 1);
  return muxM4A(packets.map(packet => packet.data), config ?? Uint8Array.of(0x12, 0x10), targetFrames, delay);
}

function muxM4A(packets, config, frames, delay = 0) {
  const join = (...parts) => {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let index = 0;
    for (const part of parts) { output.set(part, index); index += part.length; }
    return output;
  };
  const words = (...values) => {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setUint32(index * 4, value));
    return bytes;
  };
  const zero = length => new Uint8Array(length);
  const chars = value => Uint8Array.from(value, char => char.charCodeAt(0));
  const box = (type, ...parts) => {
    const content = join(...parts);
    return join(words(content.length + 8), chars(type), content);
  };
  const full = (type, flags, ...parts) => box(type, words(flags), ...parts);
  const descriptor = (tag, content) => {
    const length = [content.length & 127];
    for (let left = content.length >> 7; left; left >>= 7) length.unshift((left & 127) | 128);
    return join(Uint8Array.of(tag, ...length), content);
  };
  const matrix = words(65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824);
  const length = packets.length * AAC_FRAMES;
  const duration = Math.min(frames, length - delay);
  const ftyp = box('ftyp', chars('M4A '), words(0), chars('M4A isommp42'));
  const mediaSize = packets.reduce((sum, packet) => sum + packet.length, 0);
  const mvhd = full('mvhd', 0, words(0, 0, SAMPLE_RATE, duration, 65536, 0x01000000), zero(8), matrix, zero(24), words(2));
  const tkhd = full('tkhd', 7, words(0, 0, 1, 0, duration), zero(12), words(0x01000000), matrix, zero(8));
  const edit = box('edts', full('elst', 0, words(1, duration, delay, 65536)));
  const mdhd = full('mdhd', 0, words(0, 0, SAMPLE_RATE, length, 0x55c40000));
  const hdlr = full('hdlr', 0, words(0), chars('soun'), zero(12), chars('Rhythm Desk\0'));
  const smhd = full('smhd', 0, words(0));
  const dinf = box('dinf', full('dref', 0, words(1), full('url ', 1)));
  const decoder = descriptor(4, join(Uint8Array.of(0x40, 0x15, 0, 0, 0),
    words(AAC_CONFIG.bitrate, AAC_CONFIG.bitrate), descriptor(5, config)));
  const esds = full('esds', 0, descriptor(3, join(Uint8Array.of(0, 1, 0), decoder, descriptor(6, Uint8Array.of(2)))));
  const mp4a = box('mp4a', zero(6), Uint8Array.of(0, 1), zero(8), words(0x00020010, 0, SAMPLE_RATE * 65536), esds);
  const sizes = new DataView(new ArrayBuffer(packets.length * 4));
  packets.forEach((packet, index) => sizes.setUint32(index * 4, packet.length));
  const stbl = box('stbl', full('stsd', 0, words(1), mp4a),
    full('stts', 0, words(1, packets.length, AAC_FRAMES)),
    full('stsc', 0, words(1, 1, packets.length, 1)),
    full('stsz', 0, words(0, packets.length), new Uint8Array(sizes.buffer)),
    full('stco', 0, words(1, ftyp.length + 8)));
  const moov = box('moov', mvhd, box('trak', tkhd, edit, box('mdia', mdhd, hdlr, box('minf', smhd, dinf, stbl))));
  return new Blob([ftyp, words(mediaSize + 8), chars('mdat'), ...packets, moov], {type: 'audio/mp4'});
}
