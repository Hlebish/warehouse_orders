// Preparation and upload queues belong to one coordinator, shared by all forms.
// This module never changes image dimensions, encoding, or JPEG quality: the
// supplied prepare function owns those choices and its Blob is uploaded intact.
function queue(limit) {
  let active = 0;
  const pending = [];
  function drain() {
    while (active < limit && pending.length) {
      const job = pending.shift();
      active++;
      Promise.resolve().then(job.work).then(value => {
        active--;
        job.resolve(value);
        drain();
      }, error => {
        active--;
        job.reject(error);
        drain();
      });
    }
  }
  return work => new Promise((resolve, reject) => {
    pending.push({ work, resolve, reject });
    drain();
  });
}

function concurrency(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(name + ' must be a positive integer');
  return value;
}

/**
 * upload(blob, inputIndex, report) resolves to the stored attachment URL/value.
 * report(bytesTransferred, totalBytes) is optional; Blob.size is authoritative.
 * Progress: {prepared,total,completed,bytesTransferred,totalBytes,allPrepared,percent}. totalBytes
 * counts compressed Blobs already prepared, so it is final when prepared=total.
 * Uploads without byte reports are counted in full when they finish successfully.
 */
export function createPhotoTransfer({ prepare, preparationConcurrency = 1, uploadConcurrency = 2 } = {}) {
  if (typeof prepare !== 'function') throw new TypeError('prepare must be a function');
  const prepareQueued = queue(concurrency(preparationConcurrency, 'preparationConcurrency'));
  const uploadQueued = queue(concurrency(uploadConcurrency, 'uploadConcurrency'));
  const cache = new WeakMap();

  function prepareFile(file) {
    if ((typeof file !== 'object' || file === null) && typeof file !== 'function') {
      return Promise.reject(new TypeError('A photo must be a File or Blob object'));
    }
    if (cache.has(file)) return cache.get(file);
    const promise = prepareQueued(async () => {
      const blob = await prepare(file);
      if (!blob || !Number.isFinite(blob.size) || blob.size < 0) throw new TypeError('prepare must return a Blob');
      return blob;
    }).catch(error => {
      if (cache.get(file) === promise) cache.delete(file);
      throw error;
    });
    cache.set(file, promise);
    return promise;
  }

  async function warm(files) {
    // Selection previews are best effort. A failed decode is retried when the
    // employee actually submits; fire-and-forget warming cannot leak rejections.
    await Promise.allSettled(Array.from(files || [], prepareFile));
  }

  async function transfer(files, upload, { onProgress } = {}) {
    const list = Array.from(files || []);
    if (list.length > 5) throw new RangeError('Можно прикрепить не более пяти фотографий.');
    if (typeof upload !== 'function') throw new TypeError('upload must be a function');
    const result = new Array(list.length);
    const sizes = new Array(list.length).fill(0), sent = new Array(list.length).fill(0);
    const done = new Array(list.length).fill(false);
    let prepared = 0, completed = 0, failed = false, firstError;
    const fail = error => { if (!failed) { failed = true; firstError = error; } };
    const progress = () => {
      if (typeof onProgress !== 'function') return;
      // The denominator is the fixed photo count, not the growing sum of known
      // compressed sizes. Preparing another photo therefore cannot move the
      // displayed percentage backwards. Reserve 100% for resolved upload URLs.
      const fractions = sent.reduce((sum, value, index) => sum + (done[index] ? 1 : sizes[index] ? Math.min(.99, value / sizes[index]) : 0), 0);
      const state = {
        prepared, total: list.length, completed,
        bytesTransferred: sent.reduce((sum, value) => sum + value, 0),
        totalBytes: sizes.reduce((sum, value) => sum + value, 0),
        allPrepared: prepared === list.length,
        percent: completed === list.length ? 100 : Math.min(99, Math.round(100 * fractions / list.length))
      };
      // A rendering error must not turn a successful upload into a failed one
      // and cause it to be sent again. Observers never own transfer completion.
      try {
        const observing = onProgress(state);
        if (observing && typeof observing.catch === 'function') observing.catch(() => {});
      } catch { /* Keep preparing/uploading even if the UI observer fails. */ }
    };
    progress();
    await Promise.all(list.map(async (file, index) => {
      let blob;
      try {
        blob = await prepareFile(file);
        sizes[index] = blob.size;
        prepared++;
        progress();
      } catch (error) {
        fail(error);
        return;
      }
      if (failed) return;
      await uploadQueued(async () => {
        if (failed) return;
        let reporting = true;
        const report = bytesTransferred => {
          const value = Number(bytesTransferred);
          if (!reporting || !Number.isFinite(value)) return;
          sent[index] = Math.max(sent[index], Math.min(blob.size, Math.max(0, value)));
          progress();
        };
        try {
          result[index] = await upload(blob, index, report);
          sent[index] = blob.size;
          done[index] = true;
          completed++;
          progress();
        } catch (error) {
          // Mark failure before the shared queue starts its next pending job.
          fail(error);
        } finally {
          reporting = false;
        }
      });
    }));
    // Every started upload and preparation has settled before rejection, so an
    // immediate retry cannot race a still-running attempt from this transfer.
    if (failed) throw firstError;
    return result;
  }

  return { prepare: prepareFile, warm, transfer };
}
