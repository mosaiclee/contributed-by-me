const instrumentPresets = new Map();
const presetKey = (type, slot, stroke) => `${type}:${slot}:${stroke}`;
const presetSlots = Array.from({length: PRESET_COUNT}, (_, index) => index + 1);
const presetSample = (type, slot, stroke) => instrumentPresets.get(presetKey(type, slot, stroke));
const hasPreset = (type, slot) => TYPES[type].strokes.some(stroke => presetSample(type, slot, stroke));

function presetDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rhythm-desk.presets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('strokes', {keyPath: 'key'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Preset database is blocked'));
  });
}

async function loadInstrumentPresets() {
  const database = await presetDatabase();
  try {
    const entries = await new Promise((resolve, reject) => {
      const request = database.transaction('strokes').objectStore('strokes').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    instrumentPresets.clear();
    for (const {key, sample} of entries) instrumentPresets.set(key, sample);
  } finally {
    database.close();
  }
}

async function writePresetSample(type, slot, stroke, sample) {
  const key = presetKey(type, slot, stroke);
  const database = await presetDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('strokes', 'readwrite');
      const store = transaction.objectStore('strokes');
      if (sample) store.put({key, sample}); else store.delete(key);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    if (sample) instrumentPresets.set(key, sample); else instrumentPresets.delete(key);
  } finally {
    database.close();
  }
}

function customStrokeSample(track, stroke) {
  if (track.preset > 0) return presetSample(track.type, track.preset, stroke);
  return track.preset === -1 ? undefined : track.samples[stroke];
}
