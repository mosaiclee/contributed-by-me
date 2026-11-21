const FORMAT = 'rhythm-desk';
const HAND_MARKS = ['L', 'R', 'LR'];
const trackSequences = track => track.hands ? [track.cells, track.hands] : [track.cells];
const TRACK_LIMIT = 100;
const BPM_MIN = 20;
const BPM_MAX = 360;
// 0.22: 2520000 = 2^6·3^2·5^4·7, so a group of 3, 4, 5 or 7 cells with any cell split into 2, 3 or 4
// is exact in ticks. (0.21 used 1680000, 0.20 and older 1200000; ticks are internal only and never saved.)
const TICKS_PER_PULSE = 2520000;
const SAMPLE_RATES = [44100, 48000];
const SAMPLE_MIN_SECONDS = .05;
const SAMPLE_MAX_SECONDS = 1.5;
const SAMPLE_BUDGET = 640 * 1024;
const PRESET_COUNT = 10;
const FILE_LIMIT = 2 * 1024 * 1024;
// 0.21 timing rule (Mosaic): one beat = one beamed group of stems, every group lasts 120 / BPM
// seconds (1 s at 120), and all cells of a group are equally long. `plain` = cells of a normal group.
const TIME_SIGNATURES = {
  '4/4': { groups: 2, subdivision: 4 },
  '5/8': { groups: 2, subdivision: 3, plain: 5 },
  '6/8': { groups: 2, subdivision: 3 },
  '7/8': { groups: 2, subdivision: 3, plain: 7 },
  '9/8': { groups: 3, subdivision: 3 },
  '11/8': { groups: 2, subdivision: 3, plain: 11 },
  '13/8': { groups: 2, subdivision: 3, plain: 13 },
  '17/8': { groups: 2, subdivision: 3, plain: 17 },
  '19/8': { groups: 2, subdivision: 3, plain: 19 },
  '23/8': { groups: 2, subdivision: 3, plain: 23 }
};
// Fixed-cell meters require the newer score format.
const NEW_METERS = Object.keys(TIME_SIGNATURES).filter(meter => TIME_SIGNATURES[meter].plain !== undefined);
// Files that use fixed-cell meters or split cells are saved as version 6. Version 5 (0.20 only) is migrated on load.
const SPLIT_VERSION = 6;
// Split cells: a group entry may be an array with one value per cell, 1 = normal cell, N = that cell split
// into N equal sub-cells (0.21: only 4; 0.22: 2, 3 or 4). E.g. 4/4 [1, 3, 1, 1] = 6 cells; the group still lasts one beat.
const SPLIT = 4;
const SPLIT_MAX = 4;
// Files with a cell split into 2 or 3 are saved as version 7 (0.21 only knows 4-way splits).
const FREE_SPLIT_VERSION = 7;
const GROUP_METER_VERSION = 8;
const EXACT_TIMING_VERSION = 9;
const GRACE = ['BT', 'BS', 'TT', 'TS', 'ST', 'SS', 'TB', 'HB'];
const TYPES = {
  djembe: { name: 'Djembe', strokes: ['B', 'T', 'S', 'H', 'G', 'P', ...GRACE], volume: .78 },
  shekere: { name: 'Shekere', strokes: ['X'], volume: .55 },
  kenkeni: { name: 'Kenkeni', strokes: ['O', 'M', 'K'], volume: .68 },
  sangban: { name: 'Sangba', strokes: ['O', 'M', 'K'], volume: .76 },
  dundunba: { name: 'Dununba', strokes: ['O', 'M', 'K'], volume: .82 },
  bell: { name: 'Bell', strokes: ['X'], volume: .6 }
};
const STROKES = { B: '低音', T: '中音', S: '拍音 X', H: '高音 x', P: '轻触鼓面', G: '闷拍', O: '开放音', M: '闷音', K: '鼓边', X: '打击' };
const LEGACY_TRACKS = {
  bass: ['djembe', 'Djembe 低音', 'B'], tone: ['djembe', 'Djembe 中音', 'T'],
  slap: ['djembe', 'Djembe 拍音', 'S'], kenkeni: ['kenkeni', 'Kenkeni', 'O'],
  sangban: ['sangban', 'Sangban', 'O'], dundunba: ['dundunba', 'Dundunba', 'O'], bell: ['bell', 'Bell', 'X']
};
const ADD_TYPES = ['djembe', 'dundunba', 'sangban', 'kenkeni', 'shekere'];
const PAIRED_DRUMS = ['dundunba', 'sangban', 'kenkeni'];
const DEMO_TRACKS = [
  ['djembe', 'Break', 'Djembe Solo'], ['shekere', 'Shekere', ''],
  ['djembe', 'Djembe 1', 'Djembe High'], ['djembe', 'Djembe 2', 'Djembe Medium'],
  ['kenkeni', 'Kenkeni', 'Drum'], ['bell', 'Kenkeni Bell', 'Bell'],
  ['sangban', 'Sangba', 'Drum'], ['bell', 'Sangba Bell', 'Bell'],
  ['dundunba', 'Dununba', 'Drum'], ['bell', 'Dununba Bell', 'Bell']
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const emptyCells = length => Array(length).fill(null);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const shortText = (value, limit, fallback = '') =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || fallback : fallback;
const groupSize = entry => Array.isArray(entry) ? entry.reduce((total, count) => total + count, 0) : entry.steps?.length ?? entry;
const beatStart = (doc, beat) => doc.beats.slice(0, beat).reduce((total, size) => total + groupSize(size), 0);
const groupsPerBar = doc => TIME_SIGNATURES[doc.meter]?.groups ?? 4;
// Standard groups last one second at 120 BPM. Unmetered legacy groups use one pulse.
const pulsesPerGroup = meter => TIME_SIGNATURES[meter] ? 2 : 1;
// Length of one group in ticks: every metered group is one beat (two pulses); the index is not needed.
const groupTicks = meter => pulsesPerGroup(meter) * TICKS_PER_PULSE;
// Cell count of a normal group in this meter.
const plainGroup = meter => TIME_SIGNATURES[meter].plain ?? TIME_SIGNATURES[meter].subdivision;
const defaultGroups = meter => Array(TIME_SIGNATURES[meter].groups).fill(plainGroup(meter));
const groupMeter = (measure, group) => measure.groupMeters?.[group] ?? measure.meter;
const measureLabel = measure => measure.groupMeters
  ? measure.beats.map((_, group) => groupMeter(measure, group) ?? '–').join(' + ')
  : measure.meter;
const markVersion = (doc, version) => { doc.version = Math.max(doc.version, version); };

function validGroup(meter, entry) {
  if (!Array.isArray(entry)) return [3, 4].includes(entry) || Boolean(TIME_SIGNATURES[meter]) && entry === plainGroup(meter);
  return validGroup(meter, entry.length) && entry.some(count => count > 1) &&
    entry.every(count => Number.isInteger(count) && count >= 1 && count <= SPLIT_MAX);
}

// Straight positions (0..1) of the cells of one group.
function cellPositions(entry) {
  if (entry.steps) return entry.steps.map(step => step.at / entry.length);
  if (!Array.isArray(entry)) return Array.from({length: entry}, (_, slot) => slot / entry);
  const positions = [];
  entry.forEach((count, beat) => {
    for (let slot = 0; slot < count; slot++) positions.push((beat + slot / count) / entry.length);
  });
  return positions;
}

// Cell of `entry` nearest to `position`; with exact, -1 unless a cell starts exactly there.
function cellNear(entry, position, exact = false) {
  const positions = cellPositions(entry);
  let best = 0;
  positions.forEach((value, index) => { if (Math.abs(value - position) < Math.abs(positions[best] - position) - 1e-9) best = index; });
  if (Number.isInteger(entry) && !exact) return Math.min(entry - 1, Math.round(position * entry));
  return exact && Math.abs(positions[best] - position) > 1e-9 ? -1 : best;
}
const barStart = (doc, bar) => beatStart(doc, bar * groupsPerBar(doc));
const totalSteps = doc => beatStart(doc, doc.beats.length);
const trackBars = (doc, track) => track.measures?.length ?? doc.bars;
const scoreBars = doc => Math.max(...doc.tracks.map(track => trackBars(doc, track)));

function trackGrid(doc, track) {
  const groups = groupsPerBar(doc);
  const measures = track.measures ?? Array.from({length: doc.bars}, (_, bar) => ({
    meter: doc.meter, beats: doc.beats.slice(bar * groups, (bar + 1) * groups)
  }));
  const beats = [];
  const beatBars = [];
  const barBeats = [0];
  const barSteps = [0];
  let steps = 0;
  measures.forEach((measure, bar) => {
    for (const size of measure.beats) {
      beats.push(size);
      beatBars.push(bar);
      steps += groupSize(size);
    }
    barBeats.push(beats.length);
    barSteps.push(steps);
  });
  return {measures, beats, beatBars, barBeats, barSteps};
}

function locateStep(doc, index) {
  let beat = 0;
  while (beat < doc.beats.length && index >= groupSize(doc.beats[beat])) index -= groupSize(doc.beats[beat++]);
  return { beat, slot: index };
}

function straight(size) {
  return Array.from({length: size}, () => 100 / size);
}

function oldFeel(swing, third) {
  return {
    3: [(1 + swing / 100) * 100 / 3, (1 + (third - swing) / 100) * 100 / 3, (1 - third / 100) * 100 / 3],
    4: [25 + swing / 4, 25 - swing / 4, 25 + swing / 4, 25 - swing / 4],
    strength: 100
  };
}

function readFeel(feel) {
  if (!isRecord(feel) || !inRange(feel.strength, 0, 200)) throw new Error(t('err.swingStrength'));
  for (const size of [3, 4]) {
    const pattern = feel[size];
    if (!Array.isArray(pattern) || pattern.length !== size || !pattern.every(value => inRange(value, 3, 94)) ||
        Math.abs(pattern.reduce((sum, value) => sum + value, 0) - 100) > .001) throw new Error(t('err.swingRatio'));
  }
  const result = { 3: feel[3].slice(), 4: feel[4].slice(), strength: feel.strength };
  if (feel.compoundSwing === true) result.compoundSwing = true;
  return result;
}

function readRepeat(range, bars) {
  if (range == null) return null;
  const { from, to } = range;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > bars || from >= to) {
    throw new Error(t('err.repeat'));
  }
  return { from, to };
}

function readLoops(track, bars) {
  const ranges = track.loops ?? (track.repeat ? [track.repeat] : []);
  if (!Array.isArray(ranges) || ranges.length > bars) throw new Error(t('err.loops'));
  const loops = ranges.map(range => {
    if (!range) throw new Error(t('err.loops'));
    return readRepeat(range, bars);
  }).sort((a, b) => a.from - b.from);
  if (loops.some((range, index) => index > 0 && range.from < loops[index - 1].to)) {
    throw new Error(t('loop.overlap'));
  }
  return loops;
}

function readMeasures(input, version) {
  if (!Array.isArray(input) || !input.length) throw new Error(t('err.measures'));
  return input.map(measure => {
    if (!isRecord(measure) || (measure.meter !== null &&
        (typeof measure.meter !== 'string' || !Object.hasOwn(TIME_SIGNATURES, measure.meter))) ||
        !Array.isArray(measure.beats) || measure.beats.length !== groupsPerBar(measure)) throw new Error(t('err.measures'));
    const overrides = measure.groupMeters;
    if (overrides !== undefined && (version < GROUP_METER_VERSION || !Array.isArray(overrides) ||
        overrides.length !== measure.beats.length ||
        !overrides.every(meter => meter === null || typeof meter === 'string' && Object.hasOwn(TIME_SIGNATURES, meter)))) {
      throw new Error(t('err.measures'));
    }
    if (!measure.beats.every((size, group) => (size?.steps
      ? version >= EXACT_TIMING_VERSION && validTimedGroup(size, groupTicks(measure.meter))
      : validGroup(groupMeter(measure, group), size)))) throw new Error(t('err.measures'));
    if (measure.tempoRatios !== undefined && (!Array.isArray(measure.tempoRatios) || measure.tempoRatios.length !== measure.beats.length || !measure.tempoRatios.every(x => x === null || Number.isFinite(x) && x >= 1/18 && x <= 18))) throw new Error(t('err.measures'));
    return {meter: measure.meter, beats: structuredClone(measure.beats),
      ...(measure.tempoRatios ? {tempoRatios: measure.tempoRatios.slice()} : {}),
      ...(overrides?.some(Boolean) ? {groupMeters: overrides.slice()} : {})};
  });
}

function sampleBytes(sample) {
  if (!sample) return 0;
  return sample.pcm.length / 4 * 3 - (sample.pcm.endsWith('==') ? 2 : sample.pcm.endsWith('=') ? 1 : 0);
}

function projectSampleBytes(doc) {
  return doc.tracks.reduce((total, track) =>
    total + Object.values(track.samples).reduce((size, sample) => size + sampleBytes(sample), 0), 0);
}

function validSampleFrames(rate, frames) {
  return SAMPLE_RATES.includes(rate) && Number.isInteger(frames) &&
    inRange(frames, rate * SAMPLE_MIN_SECONDS, rate * SAMPLE_MAX_SECONDS);
}

function readSamples(input, type) {
  if (input === undefined) return {};
  if (!isRecord(input)) throw new Error(t('err.samples'));
  const samples = {};
  for (const [stroke, sample] of Object.entries(input)) {
    if (stroke.length !== 1 || !TYPES[type].strokes.includes(stroke) || !isRecord(sample) ||
        typeof sample.pcm !== 'string' || sample.pcm.length % 4 ||
        !validSampleFrames(sample.rate, sampleBytes(sample) / 2) || !/^[A-Za-z0-9+/]+={0,2}$/.test(sample.pcm)) {
      throw new Error(t('err.samples'));
    }
    samples[stroke] = {name: shortText(sample.name, 96, 'WAV 采样'), rate: sample.rate, pcm: sample.pcm};
  }
  return samples;
}

function makeTrack(doc, type, name = TYPES[type].name, detail = '', singleMeasure = false) {
  let number = 1;
  while (doc.tracks.some(track => track.id === `t${number}`)) number++;
  const beats = singleMeasure ? (doc.meter ? defaultGroups(doc.meter)
    : Array(groupsPerBar(doc)).fill(doc.subdivision)) : doc.beats;
  const track = { id: `t${number}`, type, name, detail, volume: TYPES[type].volume, pan: 0, mute: false, solo: false,
    cells: emptyCells(beats.reduce((total, size) => total + groupSize(size), 0)), loops: [], samples: {} };
  if (singleMeasure) track.measures = [{meter: doc.meter, beats}];
  return track;
}

function canAddInstrument(doc, type) {
  return ADD_TYPES.includes(type) && doc.tracks.length + (PAIRED_DRUMS.includes(type) ? 2 : 1) <= TRACK_LIMIT;
}

function addInstrumentTracks(doc, type, singleMeasure = true) {
  if (!canAddInstrument(doc, type)) return null;
  const paired = PAIRED_DRUMS.includes(type);
  let name = TYPES[type].name;
  let detail = paired ? 'Drum' : '';
  if (type === 'djembe') {
    let number = 1;
    while (doc.tracks.some(track => track.name === 'Djembe ' + number)) number++;
    name = 'Djembe ' + number;
    detail = 'Djembe';
  }
  const track = makeTrack(doc, type, name, detail, singleMeasure);
  doc.tracks.push(track);
  if (paired) {
    const bell = makeTrack(doc, 'bell', 'Bell', name, singleMeasure);
    bell.bellFor = track.id;
    doc.tracks.splice(-1, 0, bell);
  }
  if (singleMeasure) markVersion(doc, 4);
  return track;
}

// Copy structure before adding the pair, so Bell and Drum share the previous track's template.
function addInstrumentWithLayout(doc, type) {
  if (!canAddInstrument(doc, type)) return null;
  const previous = doc.tracks.at(-1);
  if (!previous) return addInstrumentTracks(doc, type);
  const measures = structuredClone(trackGrid(doc, previous).measures);
  const breaks = trackLineBreaks(doc, previous);
  const oldIds = new Set(doc.tracks.map(track => track.id));
  const drum = addInstrumentTracks(doc, type);
  for (const track of doc.tracks.filter(track => !oldIds.has(track.id))) {
    track.measures = structuredClone(measures);
    track.cells = emptyCells(trackGrid(doc, track).barSteps.at(-1));
    track.lineBreaks = breaks.slice();
    delete track.hands;
  }
  syncVersion(doc);
  return drum;
}

// Old projects named the companion Bell after its drum and placed it directly below.
function restoreTrackPairs(doc) {
  const bellsByDrum = new Map();
  const drumsById = new Map(doc.tracks
    .filter(track => PAIRED_DRUMS.includes(track.type)).map(track => [track.id, track]));
  for (const bell of doc.tracks) {
    if (bell.type !== 'bell' || bell.bellFor === undefined) continue;
    if (drumsById.has(bell.bellFor) && !bellsByDrum.has(bell.bellFor)) {
      bellsByDrum.set(bell.bellFor, bell);
    } else {
      bell.bellFor = null;
    }
  }
  doc.tracks.forEach((bell, index) => {
    if (bell.type !== 'bell' || bell.bellFor !== undefined) return;
    const drum = [doc.tracks[index - 1], doc.tracks[index + 1]].find(track => {
      if (!track || !PAIRED_DRUMS.includes(track.type) || bellsByDrum.has(track.id)) return false;
      const names = [track.name, TYPES[track.type].name];
      return names.some(name => bell.detail === name || bell.name === name + ' Bell');
    });
    bell.bellFor = drum?.id ?? null;
    if (drum) bellsByDrum.set(drum.id, bell);
  });
  const pairedBells = new Set(bellsByDrum.values());
  doc.tracks = doc.tracks.flatMap(track => pairedBells.has(track) ? [] :
    bellsByDrum.has(track.id) ? [bellsByDrum.get(track.id), track] : [track]);
}

function trackBlocks(doc) {
  const blocks = [];
  for (let index = 0; index < doc.tracks.length; index++) {
    const track = doc.tracks[index];
    const next = doc.tracks[index + 1];
    if (track.type === 'bell' && track.bellFor && next?.id === track.bellFor &&
        PAIRED_DRUMS.includes(next.type)) {
      blocks.push([track, next]);
      index++;
    } else {
      blocks.push([track]);
    }
  }
  return blocks;
}

function detachTrackPair(doc, track) {
  for (const bell of doc.tracks) {
    if (bell === track || bell.bellFor === track.id) {
      if (bell.type === 'bell') bell.bellFor = null;
    }
  }
}

function makeProject(subdivision = 3, bars = 1, meter = null) {
  const doc = { format: FORMAT, version: meter ? 3 : 2, title: 'Untitled Rhythm', bpm: 100, subdivision, bars, meter,
    beats: [], feel: {3: straight(3), 4: straight(4), strength: 100},
    region: '', ethnic: '', notes: '', volume: 1, pan: 0, repeat: null, tracks: [] };
  doc.beats = NEW_METERS.includes(meter)
    ? Array.from({length: bars}, () => defaultGroups(meter)).flat()
    : Array(groupsPerBar(doc) * bars).fill(subdivision);
  if (NEW_METERS.includes(meter)) doc.version = SPLIT_VERSION;
  addInstrumentTracks(doc, 'djembe', false);
  return doc;
}

function resetScoreMeter(doc, meter) {
  const { subdivision } = TIME_SIGNATURES[meter];
  const beats = defaultGroups(meter);
  Object.assign(doc, { meter, version: NEW_METERS.includes(meter) ? SPLIT_VERSION : 3, subdivision, bars: 1, beats, repeat: null });
  doc.tracks = [];
  addInstrumentTracks(doc, 'djembe', false);
}

function demoProject() {
  const doc = makeProject(3, 2);
  doc.tracks = [];
  for (const args of DEMO_TRACKS) doc.tracks.push(makeTrack(doc, ...args));
  doc.title = 'Rhythm Study';
  doc.bpm = 140;
  doc.repeat = { from: 0, to: 2 };
  doc.notes = '原创三细分合奏练习。可在此记录曲目的来源、版本与教学提示。';
  doc.tracks[2].pan = -.18;
  doc.tracks[3].pan = .18;
  const lines = [
    '... ... ... ... T.T T.T T.T S.T', 'X.. X.. X.. X.. X.. X.. X.. X..',
    'S.T S.. S.T S.. S.T S.. S.T S.T', 'S.T S.T S.T S.T S.T S.T S.T ST.',
    'O.O .O. O.O .O. O.O .O. O.O .OM', 'X.. .X. X.. .X. X.. .X. X.. .X.',
    '... O.. ..M O.. ... O.. ..M O.O', '.X. X.. .X. X.. .X. X.. .X. X..',
    'O.. ... O.. ... O.. ... O.M ...', 'X.. ..X X.. ..X X.. ..X X.. ..X'
  ];
  doc.tracks.forEach((track, i) => {
    track.cells = Array.from(lines[i].replaceAll(' ', ''), value => value === '.' ? null : value);
  });
  doc.tracks[0].cells[12] = 'TT';
  doc.tracks[2].cells[18] = 'SS';
  restoreTrackPairs(doc);
  return doc;
}

function readProject(input) {
  if (!isRecord(input)) throw new Error(t('err.content'));
  if (input.format === undefined && Object.hasOwn(input, 'stepsPerBar')) return readLegacy(input);
  if (input.format !== FORMAT || ![1, 2, 3, 4, 5, 6, 7, GROUP_METER_VERSION, EXACT_TIMING_VERSION, 10].includes(input.version)) throw new Error(t('err.version'));
  if (input.version === 5) input = migrateV5(input);
  const meter = input.version >= 3 ? input.meter : null;
  if ((input.version === 3 || meter !== null) && (typeof meter !== 'string' || !Object.hasOwn(TIME_SIGNATURES, meter))) {
    throw new Error(t('err.meter'));
  }
  const { title, bpm, subdivision, bars, tracks } = input;
  if (typeof title !== 'string' || !Number.isInteger(bpm) || !inRange(bpm, BPM_MIN, BPM_MAX) ||
      ![3, 4].includes(subdivision) || !Number.isSafeInteger(bars) || bars < 1 ||
      !Array.isArray(tracks) || !inRange(tracks.length, 1, TRACK_LIMIT)) throw new Error(t('err.params'));
  // Check the declared size against the file before allocating the score.
  const groups = groupsPerBar({meter}) * bars;
  const hasScoreData = input.version === 1
    ? tracks.every(track => Array.isArray(track?.cells) && track.cells.length === groups * subdivision)
    : Array.isArray(input.beats) && input.beats.length === groups;
  if (!hasScoreData) throw new Error(t('err.beats'));
  const doc = makeProject(subdivision, bars, meter);
  if (input.version >= 4) doc.version = input.version;
  doc.title = shortText(title, 64, doc.title);
  doc.bpm = bpm;
  doc.tracks = [];
  if (input.version === 1) {
    if (!inRange(input.swing, -40, 40) || !inRange(input.tripletThird ?? 0, -40, 40)) throw new Error(t('err.oldSwing'));
    doc.feel = oldFeel(input.swing, input.tripletThird ?? 0);
  } else {
    if (!Array.isArray(input.beats) || input.beats.length !== groupsPerBar(doc) * bars ||
        !input.beats.every(size => !Array.isArray(size) && validGroup(meter, size)) ||
        !inRange(input.volume, 0, 1) || !inRange(input.pan, -1, 1)) throw new Error(t('err.beats'));
    doc.beats = input.beats.slice();
    doc.feel = readFeel(input.feel);
    doc.region = shortText(input.region, 80);
    doc.ethnic = shortText(input.ethnic, 80);
    doc.notes = typeof input.notes === 'string' ? input.notes.slice(0, 8000) : '';
    doc.volume = input.volume;
    doc.pan = input.pan;
  }
  const length = totalSteps(doc);
  for (const track of tracks) {
    if (!isRecord(track) || typeof track.id !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(track.id) ||
        doc.tracks.some(known => known.id === track.id) || typeof track.type !== 'string' || !Object.hasOwn(TYPES, track.type) ||
        typeof track.name !== 'string' || !inRange(track.volume, 0, 1) || !inRange(track.pan, -1, 1) ||
        typeof track.mute !== 'boolean' || typeof track.solo !== 'boolean' || !Array.isArray(track.cells) ||
        track.cells.some(cell =>
          cell !== null && !TYPES[track.type].strokes.includes(cell))) throw new Error(t('err.tracks'));
    const { id, type, name, volume, pan, mute, solo, cells } = track;
    const measures = input.version >= 4 && track.measures !== undefined ? readMeasures(track.measures, input.version) : null;
    const part = {id, type, name: shortText(name, 28, TYPES[type].name), detail: shortText(track.detail, 28),
      volume, pan, mute, solo, cells: cells.slice(), loops: readLoops(track, measures?.length ?? bars), samples: readSamples(track.samples, type)};
    if (Number.isInteger(track.preset) && inRange(track.preset, -1, PRESET_COUNT) && track.preset !== 0) {
      part.preset = track.preset;
    }
    if (type === 'bell' && (track.bellFor === null || typeof track.bellFor === 'string')) {
      part.bellFor = track.bellFor;
    }
    if (track.tempoRatio !== undefined) {
      if (!Number.isFinite(track.tempoRatio) || track.tempoRatio < 1/18 || track.tempoRatio > 18) throw new Error(t('err.measures'));
      part.tempoRatio = track.tempoRatio;
    }
    if (measures) part.measures = measures;
    if (Array.isArray(track.hands) && track.hands.length === cells.length) {
      part.hands = Array.from(track.hands, hand => HAND_MARKS.includes(hand) ? hand : null);
    }
    if (cells.length !== (measures ? trackGrid(doc, part).barSteps.at(-1) : length)) throw new Error(t('err.cells'));
    // 0.17: display-only per-track line breaks; 0.16 stored one score-wide list, applied here to every track.
    const breaks = Array.isArray(track.lineBreaks) ? track.lineBreaks : Array.isArray(input.lineBreaks) ? input.lineBreaks : null;
    if (breaks) setTrackLineBreaks(doc, part, breaks);
    doc.tracks.push(part);
  }
  restoreTrackPairs(doc);
  if (input.version !== 1) doc.repeat = readRepeat(input.repeat, scoreBars(doc));
  if (projectSampleBytes(doc) > SAMPLE_BUDGET) throw new Error(t('err.sampleBudget'));
  return doc;
}

function readLegacy(input) {
  const { title, bpm, swing, barCount, stepsPerBar, tracks } = input;
  if (stepsPerBar !== 16) throw new Error(t('err.legacy16'));
  if (typeof title !== 'string' || !Number.isInteger(bpm) || !Number.isFinite(swing) ||
      !Number.isInteger(barCount) || !inRange(barCount, 1, 4) || !Array.isArray(tracks) ||
      !inRange(tracks.length, 1, TRACK_LIMIT)) throw new Error(t('err.legacyParams'));
  const doc = makeProject(4, barCount);
  doc.title = shortText(title, 64, doc.title);
  doc.bpm = clamp(bpm, BPM_MIN, BPM_MAX);
  doc.feel = oldFeel(clamp(-swing * 100, -40, 40), 0);
  doc.tracks = [];
  for (const source of tracks) {
    if (!isRecord(source) || typeof source.instrument !== 'string' || !Object.hasOwn(LEGACY_TRACKS, source.instrument) ||
        !Number.isFinite(source.volume) || !Array.isArray(source.steps) ||
        source.steps.some(step => typeof step !== 'boolean')) throw new Error(t('err.legacyTracks'));
    const [type, name, stroke] = LEGACY_TRACKS[source.instrument];
    const track = makeTrack(doc, type, name);
    track.volume = clamp(source.volume, 0, 1);
    track.cells = track.cells.map((_, index) => source.steps[index] ? stroke : null);
    doc.tracks.push(track);
  }
  return doc;
}

function shiftTrackLoopsAfterInsert(track, after) {
  for (const range of track.loops) {
    if (after < range.from) range.from++;
    if (after + 1 < range.to) range.to++;
  }
}

function copyTrackMeasures(doc, track, from, to) {
  const {measures, barSteps} = trackGrid(doc, track);
  const start = barSteps[from];
  const end = barSteps[to];
  return {
    measures: structuredClone(measures.slice(from, to)),
    cells: track.cells.slice(start, end),
    hands: track.hands?.slice(start, end) ?? emptyCells(end - start)
  };
}

function copyTrackSpan(doc, track, start, end) {
  const {groups, ticks} = trackTiming(doc, track);
  const steps = [];
  for (const group of groups) {
    group.steps.forEach((step, slot) => {
      const index = group.first + slot;
      if (index >= start && index < end) steps.push({...step, at: ticks[index] - ticks[start]});
    });
  }
  return {start, end, length: ticks[end] - ticks[start], steps,
    cells: track.cells.slice(start, end), hands: track.hands?.slice(start, end)};
}

function changeTrackSpanMeter(doc, track, start, end, meter) {
  const clip = copyTrackSpan(doc, track, start, end);
  const length = groupTicks(meter);
  const pattern = groupSteps(doc, plainGroup(meter), meter, length);
  const steps = [];
  for (let offset = 0; offset < clip.length; offset += length) {
    for (const step of pattern) {
      const at = offset + step.at;
      if (at < clip.length) steps.push({...step, at});
    }
  }
  const occupied = clip.steps.flatMap((step, i) => clip.cells[i] || clip.hands?.[i] ? [i] : []);
  const keepOffsets = occupied.length > steps.length;
  if (keepOffsets) {
    const existing = new Set(steps.map(step => step.at));
    for (const i of occupied) {
      const {at} = clip.steps[i];
      if (!existing.has(at)) steps.push({at, meter, parts: 1, part: 0});
    }
    steps.sort((a, b) => a.at - b.at);
  }
  const cells = emptyCells(steps.length);
  const hands = clip.hands && emptyCells(steps.length);
  let target = 0;
  occupied.forEach((source, i) => {
    const at = clip.steps[source].at;
    const limit = keepOffsets ? steps.length - 1 : steps.length - (occupied.length - i);
    while (target < limit && (keepOffsets ? steps[target].at < at :
      Math.abs(steps[target + 1].at - at) < Math.abs(steps[target].at - at))) target++;
    cells[target] = clip.cells[source];
    if (hands) hands[target] = clip.hands[source];
    target++;
  });
  const {beat, slot} = locateStep(trackGrid(doc, track), start);
  return pasteTrackSpan(doc, track, beat, slot, {...clip, steps, cells, hands});
}

function pasteTrackSpan(doc, track, firstBeat, firstSlot, clip) {
  const {measures} = trackGrid(doc, track);
  const {groups, ticks} = trackTiming(doc, track);
  const anchor = ticks[groups[firstBeat].first + firstSlot];
  // Uneven subdivisions can accumulate a one-tick rounding difference after translation.
  const boundaries = new Set(ticks);
  const snap = time => boundaries.has(time) ? time
    : boundaries.has(time - 1) ? time - 1
    : boundaries.has(time + 1) ? time + 1 : time;
  const end = snap(anchor + clip.length);
  const starts = clip.steps.map(step => snap(anchor + step.at));
  const cells = [];
  const hands = track.hands || clip.hands ? [] : null;
  const template = measures.at(-1);
  const updated = measures.slice();
  const trackEnd = ticks.at(-1);
  const templateLength = groupTicks(template.meter) * template.beats.length;
  for (let time = trackEnd; time < end; time += templateLength) updated.push(template);

  let beat = 0;
  let at = 0;
  let copied = 0;
  let cursor;
  track.measures = updated.map(measure => {
    const length = groupTicks(measure.meter);
    const next = {...measure, beats: [], groupMeters: measure.groupMeters?.slice() ?? emptyCells(measure.beats.length)};
    measure.beats.forEach((layout, group) => {
      const meter = groupMeter(measure, group);
      const source = groups[beat++];
      const destination = source?.steps ?? groupSteps(doc, layout, meter, length);
      const steps = [];
      let incoming = 0;
      const append = (step, cell, hand) => {
        if (at + step.at === anchor) cursor = {beat: beat - 1, slot: steps.length};
        steps.push(step);
        cells.push(cell ?? null);
        if (hands) hands.push(hand ?? null);
      };
      while (copied < clip.steps.length && starts[copied] < at + length) {
        const step = clip.steps[copied];
        const local = starts[copied] - at;
        while (incoming < destination.length && destination[incoming].at < local) {
          const existing = destination[incoming];
          const index = source ? source.first + incoming : -1;
          if (at + existing.at < anchor) append(existing, track.cells[index], track.hands?.[index]);
          incoming++;
        }
        append({...step, at: local}, clip.cells[copied], clip.hands?.[copied]);
        copied++;
      }
      while (incoming < destination.length) {
        const step = destination[incoming];
        const index = source ? source.first + incoming : -1;
        if (at + step.at < anchor || at + step.at >= end) append(step, track.cells[index], track.hands?.[index]);
        incoming++;
      }
      const same = (left, right) => left.length === right.length && left.every((step, i) =>
        step.at === right[i].at && step.meter === right[i].meter && step.parts === right[i].parts && step.part === right[i].part);
      if (same(steps, destination)) next.beats.push(layout);
      else {
        const copiedMeter = steps[0]?.meter;
        const counts = steps.filter(step => step.part === 0).map(step => step.parts);
        const regular = counts.some(count => count > 1) ? counts : counts.length;
        if (copiedMeter && validGroup(copiedMeter, regular) && same(steps, groupSteps(doc, regular, copiedMeter, length))) {
          next.beats.push(regular);
          next.groupMeters[group] = copiedMeter === measure.meter ? null : copiedMeter;
        } else next.beats.push({length, steps});
      }
      at += length;
    });
    if (!next.groupMeters.some(Boolean)) delete next.groupMeters;
    return next;
  });
  track.cells = cells;
  if (hands) track.hands = hands;
  markVersion(doc, 4);
  return cursor;
}

function pasteTrackMeasures(doc, track, bar, start, clip) {
  const grid = trackGrid(doc, track);
  let end = start + clip.cells.length;
  let padding = 0;
  if (start === grid.barSteps[bar]) {
    const after = bar + clip.measures.length;
    end = grid.barSteps[Math.min(after, grid.measures.length)];
    track.measures = grid.measures.slice(0, bar)
      .concat(structuredClone(clip.measures), grid.measures.slice(after));
  } else {
    track.measures = grid.measures.slice();
    const last = grid.measures.at(-1);
    const size = last.beats.reduce((total, group) => total + groupSize(group), 0);
    for (let length = track.cells.length; length < end; length += size) {
      track.measures.push(structuredClone(last));
      padding = length + size - end;
    }
  }
  const oldLength = track.cells.length;
  track.cells = track.cells.slice(0, start).concat(clip.cells, track.cells.slice(end), emptyCells(padding));
  if (track.hands || clip.hands.some(Boolean)) {
    const hands = track.hands ?? emptyCells(oldLength);
    track.hands = hands.slice(0, start).concat(clip.hands, hands.slice(end), emptyCells(padding));
  }
  markVersion(doc, 4);
}

function insertTrackBar(doc, track, after, duplicate = false) {
  const grid = trackGrid(doc, track);
  const previous = grid.measures[after];
  const start = grid.barSteps[after];
  const end = grid.barSteps[after + 1];
  track.measures = grid.measures.slice();
  track.measures.splice(after + 1, 0, structuredClone(previous));
  for (const sequence of trackSequences(track)) sequence.splice(end, 0, ...(duplicate ? sequence.slice(start, end) : emptyCells(end - start)));
  shiftTrackLoopsAfterInsert(track, after);
  markVersion(doc, 4);
  shiftTrackLineBreaks(doc, track, after, 1);
}

function insertBar(doc, after, duplicate) {
  const sharedTracks = doc.tracks.some(track => !track.measures);
  const groups = groupsPerBar(doc);
  const baselineBar = Math.min(after, doc.bars - 1);
  const firstGroup = baselineBar * groups;
  const nextGroup = firstGroup + groups;
  const start = barStart(doc, baselineBar);
  const end = barStart(doc, baselineBar + 1);
  const beats = doc.beats.slice(firstGroup, nextGroup);
  const blanks = emptyCells(end - start);
  for (const track of doc.tracks) {
    if (track.measures) {
      insertTrackBar(doc, track, Math.min(after, track.measures.length - 1), duplicate);
      continue;
    }
    for (const sequence of trackSequences(track)) sequence.splice(end, 0, ...(duplicate ? sequence.slice(start, end) : blanks));
    shiftTrackLoopsAfterInsert(track, baselineBar);
    if (track.lineBreaks) track.lineBreaks = track.lineBreaks.map(index => index > baselineBar ? index + 1 : index);
  }
  if (sharedTracks) {
    doc.beats.splice(nextGroup, 0, ...beats);
    doc.bars++;
  }
  if (doc.repeat) {
    if (after < doc.repeat.from) doc.repeat.from++;
    if (after < doc.repeat.to) doc.repeat.to++;
  }
}

function deleteBar(doc, bar) {
  const afterRemoval = range => ({
    from: range.from - Number(bar < range.from), to: range.to - Number(bar < range.to)
  });
  if (doc.repeat) {
    const range = afterRemoval(doc.repeat);
    doc.repeat = range.from < range.to ? range : null;
  }
  for (const track of doc.tracks) {
    const count = trackBars(doc, track);
    if (count < 2 || bar >= count) continue;
    const grid = trackGrid(doc, track);
    const start = grid.barSteps[bar];
    for (const sequence of trackSequences(track)) sequence.splice(start, grid.barSteps[bar + 1] - start);
    if (track.measures) track.measures.splice(bar, 1);
    track.loops = track.loops.map(afterRemoval).filter(range => range.from < range.to);
    if (track.lineBreaks) track.lineBreaks = track.lineBreaks.map(index => index > bar ? index - 1 : index);
  }
  if (doc.bars > 1 && bar < doc.bars) {
    const groups = groupsPerBar(doc);
    doc.beats.splice(bar * groups, groups);
    doc.bars--;
  }
  for (const track of doc.tracks) if (track.lineBreaks) setTrackLineBreaks(doc, track, track.lineBreaks);
}

// 0.17 line breaks: track.lineBreaks lists bar indexes of that track that start a new line.
// They only change the on-screen layout; playback and audio export never read them.
function trackLineBreaks(doc, track) {
  if (!Array.isArray(track.lineBreaks)) return [];
  const bars = trackBars(doc, track);
  return [...new Set(track.lineBreaks)].filter(bar => Number.isInteger(bar) && bar > 0 && bar < bars).sort((a, b) => a - b);
}

function setTrackLineBreaks(doc, track, list) {
  track.lineBreaks = list;
  const clean = trackLineBreaks(doc, track);
  if (clean.length) track.lineBreaks = clean;
  else delete track.lineBreaks;
}

function toggleTrackLineBreak(doc, track, bar) {
  const list = trackLineBreaks(doc, track);
  setTrackLineBreaks(doc, track, list.includes(bar) ? list.filter(item => item !== bar) : [...list, bar]);
}

// A bar was inserted after `after` (delta 1): breaks behind it move with their bars.
function shiftTrackLineBreaks(doc, track, after, delta) {
  if (track.lineBreaks) setTrackLineBreaks(doc, track, track.lineBreaks.map(bar => bar > after ? bar + delta : bar));
}

// Insert an empty bar into one track only so it becomes that track's bar `at`.
// It copies the meter and grouping of its left neighbour (of bar 1 when inserted at the start).
// keepBreak: when `at` starts a line, the new bar starts that line instead of ending the line above.
function insertTrackBarAt(doc, track, at, keepBreak = false) {
  const hadBreak = trackLineBreaks(doc, track).includes(at);
  if (at > 0) {
    insertTrackBar(doc, track, at - 1, false);
  } else {
    const loops = track.loops.map(range => ({from: range.from + 1, to: range.to + 1}));
    insertTrackBar(doc, track, 0, false);
    const {barSteps} = trackGrid(doc, track);
    for (const sequence of trackSequences(track)) {
      const first = sequence.slice(barSteps[0], barSteps[1]);
      sequence.splice(barSteps[0], barSteps[1] - barSteps[0], ...sequence.slice(barSteps[1], barSteps[2]));
      sequence.splice(barSteps[1], barSteps[2] - barSteps[1], ...first);
    }
    track.loops = loops;
  }
  if (keepBreak && hadBreak) setTrackLineBreaks(doc, track, track.lineBreaks.map(bar => bar === at + 1 ? at : bar));
}

// Delete one bar from one track only. Other tracks keep their bars, notes and loops.
function deleteTrackBar(doc, track, bar) {
  const grid = trackGrid(doc, track);
  if (grid.measures.length < 2 || bar >= grid.measures.length) return;
  const start = grid.barSteps[bar];
  for (const sequence of trackSequences(track)) sequence.splice(start, grid.barSteps[bar + 1] - start);
  track.measures = grid.measures.slice();
  track.measures.splice(bar, 1);
  track.loops = track.loops.map(range => ({from: range.from - Number(bar < range.from), to: range.to - Number(bar < range.to)}))
    .filter(range => range.from < range.to);
  markVersion(doc, 4);
  shiftTrackLineBreaks(doc, track, bar, -1);
  if (doc.repeat) {
    const to = Math.min(doc.repeat.to, scoreBars(doc));
    doc.repeat = doc.repeat.from < to ? {...doc.repeat, to} : null;
  }
}

function convertCells(cells, oldSizes, sizes) {
  const converted = [];
  let collisions = 0;
  let offset = 0;
  oldSizes.forEach((oldSize, beat) => {
    const size = sizes[beat];
    const group = emptyCells(groupSize(size));
    const positions = cellPositions(oldSize);
    for (let slot = 0; slot < positions.length; slot++) {
      const stroke = cells[offset + slot];
      if (!stroke) continue;
      const target = !Number.isInteger(size) || !Number.isInteger(oldSize)
        ? cellNear(size, positions[slot]) : Math.min(size - 1, Math.round(slot * size / oldSize));
      if (group[target]) collisions++;
      else group[target] = stroke;
    }
    converted.push(...group);
    offset += positions.length;
  });
  return { converted, collisions };
}

function measureMeterChange(track, grid, bar, meter) {
  const measure = {meter, beats: defaultGroups(meter)};
  const cells = emptyCells(measure.beats.reduce((total, size) => total + size, 0));
  const previous = grid.measures[bar];
  // Where each new group starts and ends, in ticks from the start of the bar.
  const bounds = [];
  let offset = 0;
  let firstCell = 0;
  measure.beats.forEach((size, group) => {
    const length = groupTicks(meter);
    bounds.push({from: offset, length, size, firstCell});
    offset += length;
    firstCell += size;
  });
  let index = grid.barSteps[bar];
  let dropped = 0;
  let groupStart = 0;
  previous.beats.forEach((size, group) => {
    const length = groupTicks(previous.meter);
    for (const position of cellPositions(size)) {
      const stroke = track.cells[index++];
      if (!stroke) continue;
      const time = groupStart + position * length;
      const target = bounds.find(item => time < item.from + item.length - 1e-6);
      if (!target) { dropped++; continue; }
      const cell = target.firstCell + Math.min(target.size - 1, Math.round((time - target.from) / target.length * target.size));
      if (cells[cell]) dropped++;
      else cells[cell] = stroke;
    }
    groupStart += length;
  });
  return {measure, cells, dropped};
}

function beatFraction(doc, size, slot, meter = doc.meter) {
  if (!slot) return 0;
  if (slot === size) return 1;
  if (meter !== '4/4' && TIME_SIGNATURES[meter] && !doc.feel.compoundSwing) return slot / size;
  if (!doc.feel[size]) return slot / size;
  const widths = doc.feel[size].map(value => Math.max(3, 100 / size + (value - 100 / size) * doc.feel.strength / 100));
  const elapsed = widths.slice(0, slot).reduce((sum, value) => sum + value, 0);
  return elapsed / widths.reduce((sum, value) => sum + value, 0);
}

function validTimedGroup(layout, length) {
  return layout.length === length && Array.isArray(layout.steps) &&
    layout.steps.every((step, i) => isRecord(step) && Number.isInteger(step.at) &&
      step.at >= 0 && step.at < length && (!i || step.at > layout.steps[i - 1].at) &&
      (step.meter === null || typeof step.meter === 'string' && Object.hasOwn(TIME_SIGNATURES, step.meter)) &&
      Number.isInteger(step.parts) && step.parts >= 1 && step.parts <= SPLIT_MAX &&
      Number.isInteger(step.part) && step.part >= 0 && step.part < step.parts);
}

function groupSteps(doc, layout, meter, length) {
  if (layout.steps) return layout.steps;
  if (!Array.isArray(layout)) {
    return Array.from({length: layout}, (_, slot) => ({
      at: Math.round(beatFraction(doc, layout, slot, meter) * length), meter, parts: 1, part: 0
    }));
  }
  return layout.flatMap((parts, cell) => Array.from({length: parts}, (_, part) => ({
    at: Math.round(cell * (length / layout.length) + part * (length / layout.length) / parts), meter, parts, part
  })));
}

function trackTiming(doc, track, useTempo = false) {
  const {measures, barSteps} = trackGrid(doc, track);
  const ticks = [];
  const groups = [];
  let start = 0;
  for (const measure of measures) {
    measure.beats.forEach((layout, group) => {
      const length = groupTicks(measure.meter);
      const steps = groupSteps(doc, layout, groupMeter(measure, group), length);
      groups.push({first: ticks.length, steps});
      const ratio = useTempo ? doc.bpm / effectiveTempo(doc, track, measure, group) : 1;
      for (const step of steps) ticks.push(start + step.at * ratio);
      start += length * ratio;
    });
  }
  ticks.push(start);
  return {ticks, barSteps, groups};
}

// 0.21: split state of cell `slot` of group `beat` (cells are counted before splitting).
function beatSplitInfo(doc, track, beat, slot) {
  const grid = trackGrid(doc, track);
  const bar = grid.beatBars[beat];
  const meter = grid.measures[bar].meter;
  const entry = grid.beats[beat];
  if (entry.steps) {
    const step = entry.steps[slot];
    const first = slot - step.part;
    const complete = first >= 0 && Array.from({length: step.parts}, (_, part) => {
      const candidate = entry.steps[first + part];
      return candidate?.parts === step.parts && candidate.part === part && candidate.meter === step.meter;
    }).every(Boolean);
    return {grid, bar, meter, entry, part: first, count: step.parts, canEdit: complete};
  }
  if (!Array.isArray(entry)) return {grid, bar, meter, entry, part: slot, count: 1, split: false, canSplit: true, canMerge: false};
  let part = 0;
  let rest = slot;
  while (part < entry.length - 1 && rest >= entry[part]) rest -= entry[part++];
  const count = entry[part];
  return {grid, bar, meter, entry, part, count, split: count > 1, canSplit: count !== SPLIT, canMerge: count > 1};
}

// New measures and cells after splitting the cell under `slot` into `parts` equal sub-cells (1 = not split),
// or null when it already has that many. `true` / `false` mean 4 / 1 (0.21 calls).
function splitTrackBeat(doc, track, beat, slot, parts) {
  const count = parts === true ? SPLIT : parts === false ? 1 : parts;
  if (!Number.isInteger(count) || count < 1 || count > SPLIT_MAX) return null;
  const info = beatSplitInfo(doc, track, beat, slot);
  if (info.count === count) return null;
  const {grid, entry, part} = info;
  if (entry.steps) {
    if (!info.canEdit) return null;
    const start = beatStart(grid, beat) + part;
    const first = entry.steps[part];
    const end = entry.steps[part + info.count]?.at ?? entry.length;
    if (end - first.at < count) return null;
    const replacement = Array.from({length: count}, (_, i) => ({
      ...first, at: first.at + Math.round((end - first.at) * i / count), parts: count, part: i
    }));
    const values = emptyCells(count);
    let dropped = 0;
    for (let i = 0; i < info.count; i++) {
      const value = track.cells[start + i];
      if (!value) continue;
      const target = replacement.findIndex(step => step.at === entry.steps[part + i].at);
      if (target < 0) dropped++;
      else values[target] = value;
    }
    const cells = track.cells.slice();
    cells.splice(start, info.count, ...values);
    const measures = structuredClone(grid.measures);
    const steps = measures[info.bar].beats[beat - grid.barBeats[info.bar]].steps;
    steps.splice(part, info.count, ...replacement);
    return {measures, cells, dropped, part, slot: part};
  }
  let next = Array.isArray(entry) ? entry.slice() : Array(entry).fill(1);
  next[part] = count;
  if (next.every(count => count === 1)) next = next.length;
  const start = beatStart(grid, beat);
  const old = cellPositions(entry);
  const group = emptyCells(groupSize(next));
  let dropped = 0;
  old.forEach((position, index) => {
    const stroke = track.cells[start + index];
    if (!stroke) return;
    const target = cellNear(next, position, true);
    if (target < 0 || group[target]) dropped++;
    else group[target] = stroke;
  });
  const cells = track.cells.slice();
  cells.splice(start, old.length, ...group);
  const sizes = grid.beats.slice();
  sizes[beat] = next;
  const measures = grid.measures.map((measure, bar) => ({
    ...measure, beats: sizes.slice(grid.barBeats[bar], grid.barBeats[bar + 1])
  }));
  return {measures, cells, dropped, part, slot: Array.isArray(next) ? groupSize(next.slice(0, part)) : part};
}

// Whether a document needs format version 6 (fixed-cell meters or split cells).
function usesSplitVersion(doc) {
  const meters = [doc.meter, ...doc.tracks.flatMap(track => track.measures?.map(measure => measure.meter) ?? [])];
  return meters.some(meter => NEW_METERS.includes(meter)) ||
    doc.tracks.some(track => track.measures?.some(measure => measure.beats.some(Array.isArray)));
}

// Keeps doc.version at 6 exactly while the document uses fixed-cell meters or split cells, so older versions
// report a clear "unknown version" for those files and still open every other file.
function syncVersion(doc) {
  if (doc.tracks.some(track => track.tempoRatio !== undefined || track.measures?.some(m => m.tempoRatios))) { doc.version = 10; return; }
  if (doc.tracks.some(track => track.measures?.some(measure => measure.beats.some(layout => layout.steps)))) {
    doc.version = EXACT_TIMING_VERSION;
    return;
  }
  if (doc.tracks.some(track => track.measures?.some(measure => measure.groupMeters))) {
    doc.version = GROUP_METER_VERSION;
    return;
  }
  const free = doc.tracks.some(track => track.measures?.some(measure => measure.beats.some(entry => Array.isArray(entry) && entry.some(count => count === 2 || count === 3))));
  if (free) doc.version = FREE_SPLIT_VERSION;
  else if (usesSplitVersion(doc)) doc.version = SPLIT_VERSION;
  else if (doc.version >= 5) doc.version = doc.tracks.some(track => track.measures) ? 4 : doc.meter ? 3 : 2;
}

// 0.20 (file version 5) grouped 5/8 as 3+2 and 7/8 as 2+2+3 eighths, and split one beat at a time
// (a 4/4 quarter = 2 cells into four 16ths). Best-effort conversion to the 0.21 rule:
// - 4/4 split quarter [.., 4] -> both of its cells split [4, 4]; the 16ths land exactly on sub-cells 1 and 3 of each.
// - 6/8, 9/8: a 0.20 split eighth already was one split cell; nothing changes.
// - 5/8, 7/8: the bar's 5 / 7 eighths (with their splits) become the first group of 5 / 7 cells; the second
//   group of the bar is added empty. A tuplet group is first mapped onto its eighths (overlaps dropped).
const V5_GROUPS = {'5/8': [3, 2], '7/8': [2, 2, 3]};

function migrateBarV5(meter, groups, cells) {
  const out = {beats: [], cells: []};
  if (meter === '4/4') {
    groups.forEach((entry, index) => {
      const slice = cells.splice(0, groupSize(entry));
      if (!Array.isArray(entry)) { out.beats.push(entry); out.cells.push(...slice); return; }
      const next = [];
      for (const count of entry) {
        const part = slice.splice(0, count);
        if (count === 4) { next.push(4, 4); out.cells.push(part[0], null, part[1], null, part[2], null, part[3], null); }
        else { next.push(1, 1); out.cells.push(...part); }
      }
      out.beats.push(next.every(count => count === 1) ? next.length : next);
    });
    return out;
  }
  if (!V5_GROUPS[meter]) { out.beats = groups; out.cells = cells; return out; }
  const flat = [];
  V5_GROUPS[meter].forEach((eighths, index) => {
    const entry = groups[index];
    const slice = cells.splice(0, groupSize(entry));
    if (Array.isArray(entry)) { flat.push(...entry); out.cells.push(...slice); return; }
    if (entry === eighths) { flat.push(...Array(eighths).fill(1)); out.cells.push(...slice); return; }
    const mapped = emptyCells(eighths);
    slice.forEach((stroke, slot) => {
      const target = Math.min(eighths - 1, Math.round(slot * eighths / entry));
      if (stroke && !mapped[target]) mapped[target] = stroke;
    });
    flat.push(...Array(eighths).fill(1));
    out.cells.push(...mapped);
  });
  const plain = TIME_SIGNATURES[meter].plain;
  out.beats = [flat.every(count => count === 1) ? plain : flat, plain];
  out.cells.push(...emptyCells(plain));
  return out;
}

function migrateV5(source) {
  const input = structuredClone(source);
  input.version = SPLIT_VERSION;
  const oldGroups = meter => V5_GROUPS[meter]?.length ?? TIME_SIGNATURES[meter]?.groups ?? 4;
  const groupsOk = list => Array.isArray(list) && list.every(entry => Number.isInteger(entry) || Array.isArray(entry) && entry.every(Number.isInteger));
  if (!Array.isArray(input.tracks) || !groupsOk(input.beats)) return input;
  const docMeter = input.meter ?? null;
  const shared = Array.isArray(input.beats) && (V5_GROUPS[docMeter] || docMeter === '4/4');
  const sharedBeats = [];
  if (shared) {
    const count = oldGroups(docMeter);
    for (let bar = 0; bar * count < input.beats.length; bar++) sharedBeats.push(input.beats.slice(bar * count, (bar + 1) * count));
    input.beats = sharedBeats.flatMap(groups => migrateBarV5(docMeter, groups, emptyCells(groups.reduce((t, e) => t + groupSize(e), 0))).beats);
  }
  for (const track of input.tracks) {
    if (!isRecord(track) || !Array.isArray(track.cells)) continue;
    const cells = track.cells.slice();
    const result = [];
    if (Array.isArray(track.measures)) {
      if (!track.measures.every(measure => isRecord(measure) && groupsOk(measure.beats))) continue;
      track.measures = track.measures.map(measure => {
        const bar = migrateBarV5(measure.meter, measure.beats, cells.splice(0, measure.beats.reduce((t, e) => t + groupSize(e), 0)));
        result.push(...bar.cells);
        return {meter: measure.meter, beats: bar.beats};
      });
    } else if (shared) {
      for (const groups of sharedBeats) result.push(...migrateBarV5(docMeter, groups, cells.splice(0, groups.reduce((t, e) => t + groupSize(e), 0))).cells);
    } else continue;
    track.cells = result.concat(cells);
  }
  return input;
}

const playbackSeconds = (ticks, bpm) => ticks * 60 / (TICKS_PER_PULSE * bpm);

function safeFileName(title) {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '') || 'rhythm';
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

// Store ratios so the global tempo also scales local settings, within 20–360 BPM.
function effectiveTempo(doc, track, measure, group) {
  return clamp(doc.bpm * (measure?.tempoRatios?.[group] ?? track?.tempoRatio ?? 1), BPM_MIN, BPM_MAX);
}
function copyBoundaryEnd(from, boundary, side, bars) {
  const end = side === 'end' || boundary === bars ? boundary : boundary + 1;
  return from !== null && boundary > from && end > from && end <= bars ? end : null;
}
function loopEndpointAllowed(track, from, to, bars) {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from && to <= bars &&
    !track.loops.some(loop => loop.from !== from && from < loop.to && loop.from < to);
}
function splitTrackRange(doc, track, fromBar, toBar, parts) {
  const work = structuredClone(track);
  const grid = trackGrid(doc, work);
  const first = grid.barBeats[fromBar], end = grid.barBeats[toBar];
  for (let beat = end - 1; beat >= first; beat--) {
    let slot = groupSize(trackGrid(doc, work).beats[beat]) - 1;
    while (slot >= 0) {
      const info = beatSplitInfo(doc, work, beat, slot);
      const result = splitTrackBeat(doc, work, beat, slot, parts);
      if (result) {
        const hands = work.hands && splitTrackBeat(doc, {...work, cells: work.hands}, beat, slot, parts);
        if (result.dropped || hands?.dropped) throw new Error(t('beat.clearBeforeSplit'));
        work.measures = result.measures; work.cells = result.cells;
        if (hands) work.hands = hands.cells;
      }
      slot -= info.count;
    }
  }
  return work;
}
