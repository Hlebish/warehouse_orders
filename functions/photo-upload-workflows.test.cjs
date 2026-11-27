const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function photoProgressText('), end = source.indexOf('let entrySending=', start);
assert.ok(start >= 0 && end > start, 'Missing application photo upload helpers');

async function harness({ uploadBehavior } = {}) {
  const { createPhotoTransfer } = await import('../photo-transfer.mjs');
  const objects = new Map(), trace = [], attempts = new Map();
  let nextId = 0;
  const context = vm.createContext({
    photoTransfer: createPhotoTransfer({ prepare: async file => file, preparationConcurrency: 1, uploadConcurrency: 2 }),
    signedInUser: { uid: 'worker' }, storage: {},
    crypto: { randomUUID: () => 'photo-' + (++nextId) },
    $: () => null,
    storageRef: (_storage, storagePath) => storagePath,
    async uploadBytes(storagePath, blob, metadata) {
      assert.equal(metadata.contentType, 'image/jpeg');
      trace.push({ kind: 'upload', transport: 'single', path: storagePath });
      const attempt = (attempts.get(storagePath) || 0) + 1;
      attempts.set(storagePath, attempt);
      if (uploadBehavior) await uploadBehavior({ path: storagePath, blob, attempt, objects });
      assert.equal(objects.has(storagePath), false, 'an immutable uploaded attachment must not be overwritten');
      objects.set(storagePath, blob);
    },
    uploadBytesResumable(storagePath, blob) {
      trace.push({ kind: 'upload', transport: 'resumable', path: storagePath });
      const attempt = (attempts.get(storagePath) || 0) + 1;
      attempts.set(storagePath, attempt);
      return {
        on(event, progress, failure, complete) {
          assert.equal(event, 'state_changed');
          Promise.resolve().then(async () => {
            progress({ bytesTransferred: Math.floor(blob.size / 2), totalBytes: blob.size });
            if (uploadBehavior) await uploadBehavior({ path: storagePath, blob, attempt, objects });
            assert.equal(objects.has(storagePath), false, 'an immutable uploaded attachment must not be overwritten');
            objects.set(storagePath, blob);
            progress({ bytesTransferred: blob.size, totalBytes: blob.size });
            complete();
          }).catch(failure);
        },
      };
    },
    async getDownloadURL(storagePath) {
      trace.push({ kind: 'url', path: storagePath });
      if (!objects.has(storagePath)) throw Object.assign(new Error('not found'), { code: 'storage/object-not-found' });
      return 'https://firebasestorage.googleapis.com/v0/b/example/o/' + encodeURIComponent(storagePath) + '?alt=media';
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, objects, trace, attempts };
}

const photo = (size = 1000) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
const uploadPaths = app => app.trace.filter(event => event.kind === 'upload').map(event => event.path);

test('an inspection first upload sends the JPEG directly without a failing existence request', async () => {
  const app = await harness(), files = [photo(), photo()];
  const urls = await app.context.uploadInspectionPhotos('inspection', 'defect', files);
  assert.equal(urls.length, 2);
  for (let index = 0; index < 2; index++) {
    const storagePath = `inspectionItems/inspection/worker/defect/${index}.jpg`;
    assert.deepEqual(app.trace.filter(event => event.path === storagePath).map(event => event.kind), ['upload', 'url']);
  }
  assert.deepEqual(Array.from(await app.context.uploadInspectionPhotos('inspection', 'defect', files)), Array.from(urls));
  assert.equal(uploadPaths(app).length, 2, 'a retried inspection must reuse both already uploaded photos');
});

test('shared chat retries reuse stable attachment paths and upload only the failed photo', async () => {
  const failedPath = 'chat/worker/draft-photo-2.jpg';
  const app = await harness({
    uploadBehavior: async ({ path: storagePath, attempt }) => {
      if (storagePath === failedPath && attempt === 1) throw new Error('temporary upload failure');
    },
  });
  const draft = { id: 'draft' }, files = [photo(), photo()];
  await assert.rejects(app.context.uploadGroupChatPhotos('worker', draft, files), /temporary upload failure/);
  assert.equal(app.objects.has('chat/worker/draft-photo-1.jpg'), true);
  const urls = await app.context.uploadGroupChatPhotos('worker', draft, files);
  assert.equal(urls.length, 2);
  assert.deepEqual(uploadPaths(app), ['chat/worker/draft-photo-1.jpg', failedPath, failedPath]);
  assert.deepEqual(Array.from(await app.context.uploadGroupChatPhotos('worker', draft, files)), Array.from(urls));
  assert.equal(uploadPaths(app).length, 3, 'retrying a later message-write failure must upload no attachments again');
});

test('a shared chat retry recovers a photo accepted by Storage after a lost acknowledgement', async () => {
  const app = await harness({
    uploadBehavior: async ({ path: storagePath, blob, attempt, objects }) => {
      if (attempt === 1) {
        objects.set(storagePath, blob);
        throw new Error('upload response lost');
      }
    },
  });
  const draft = { id: 'ambiguous' }, files = [photo()];
  await assert.rejects(app.context.uploadGroupChatPhotos('worker', draft, files), /upload response lost/);
  const urls = await app.context.uploadGroupChatPhotos('worker', draft, files);
  assert.equal(urls.length, 1);
  assert.deepEqual(uploadPaths(app), ['chat/worker/ambiguous-photo-1.jpg']);
  assert.deepEqual(app.trace.map(event => event.kind), ['upload', 'url']);
});

test('direct chat keeps Storage paths and avoids download-URL requests on a successful first upload', async () => {
  const app = await harness(), draft = { id: 'direct-message' }, files = [photo(), photo()];
  const expected = ['directChats/thread/worker/direct-message/0.jpg', 'directChats/thread/worker/direct-message/1.jpg'];
  assert.deepEqual(Array.from(await app.context.uploadDirectChatPhotos('thread', 'worker', draft, files)), expected);
  assert.deepEqual(Array.from(await app.context.uploadDirectChatPhotos('thread', 'worker', draft, files)), expected);
  assert.deepEqual(uploadPaths(app), expected);
  assert.equal(app.trace.some(event => event.kind === 'url'), false);
});

test('order defect upload retries reuse the compressed object and its original attachment path', async () => {
  const app = await harness(), files = [photo()];
  const first = await app.context.uploadPhotos('order', 'entry', files);
  assert.deepEqual(Array.from(await app.context.uploadPhotos('order', 'entry', files)), Array.from(first));
  assert.equal(uploadPaths(app).length, 1);
  assert.match(uploadPaths(app)[0], /^orders\/order\/entry\/photo-1-/);
});

test('small JPEGs use a single request while photos above 512 KiB retain resumable uploads', async () => {
  const app = await harness(), draft = { id: 'boundary' }, files = [photo(512 * 1024), photo(512 * 1024 + 1)];
  const first = await app.context.uploadGroupChatPhotos('worker', draft, files);
  assert.deepEqual(app.trace.filter(event => event.kind === 'upload').map(event => event.transport), ['single', 'resumable']);
  assert.deepEqual(Array.from(await app.context.uploadGroupChatPhotos('worker', draft, files)), Array.from(first));
  assert.equal(uploadPaths(app).length, 2, 'both transport types retain their uploaded result for retries');
});

test('progress distinguishes preparation from final upload percentages and saving the record', async () => {
  const { context } = await harness();
  const preparing = context.photoProgressText({ total: 5, prepared: 2, completed: 1, percent: 25 });
  assert.match(preparing, /2\/5/);
  assert.doesNotMatch(preparing, /%/);
  assert.match(context.photoProgressText({ total: 5, prepared: 5, completed: 2, percent: 57,
    bytesTransferred: 1, totalBytes: 100 }), /57%/);
  assert.match(context.photoProgressText({ total: 5, prepared: 5, completed: 5, percent: 100 }), /Сохраняем запись/);
});

test('shared chat recovers an accepted message after its write acknowledgement is lost', async () => {
  const { context } = await harness(), records = new Map(), writeFailure = new Error('write response lost');
  context.db = {};
  context.doc = (_db, ...parts) => parts.join('/');
  context.setDoc = async (ref, message) => { records.set(ref, structuredClone(message)); throw writeFailure; };
  context.getDocFromServer = async ref => ({ exists: () => records.has(ref), data: () => records.get(ref) });
  const message = { text: 'Фото дефекта', photos: ['photo-url'], authorId: 'worker', isUrgent: false, readBy: ['worker'], likes: [] };
  const result = await context.commitGroupChatMessage('stable-message', message);
  assert.equal(result.duplicate, true);
  assert.deepEqual([...records.keys()], ['chatMessages/stable-message']);
});

test('shared chat retry recognises its existing message without overwriting newer reactions and receipts', async () => {
  const { context } = await harness();
  const message = { text: 'Фото дефекта', photos: ['photo-url'], authorId: 'worker', isUrgent: false, readBy: ['worker'], likes: [] };
  const saved = { ...message, readBy: ['worker', 'recipient'], likes: ['recipient'] };
  context.db = {};
  context.doc = (_db, ...parts) => parts.join('/');
  context.setDoc = async () => { throw Object.assign(new Error('immutable message already exists'), { code: 'permission-denied' }); };
  context.getDocFromServer = async () => ({ exists: () => true, data: () => saved });
  assert.equal((await context.commitGroupChatMessage('stable-message', message)).duplicate, true);
  assert.deepEqual(saved.readBy, ['worker', 'recipient']);
  assert.deepEqual(saved.likes, ['recipient']);
});

test('shared chat keeps a failed draft when the server message is missing or has different content', async () => {
  const { context } = await harness(), writeFailure = new Error('write denied');
  const message = { text: 'Фото дефекта', photos: ['photo-url'], authorId: 'worker' };
  context.db = {};
  context.doc = (_db, ...parts) => parts.join('/');
  context.setDoc = async () => { throw writeFailure; };
  context.getDocFromServer = async () => ({ exists: () => false });
  await assert.rejects(context.commitGroupChatMessage('stable-message', message), error => error === writeFailure);
  context.getDocFromServer = async () => ({ exists: () => true, data: () => ({ ...message, photos: ['different-photo'] }) });
  await assert.rejects(context.commitGroupChatMessage('stable-message', message), /другим содержимым/);
});

test('retrying the actual shared-chat submit keeps its message ID and previously uploaded photographs', async () => {
  const app = await harness(), { context } = app;
  const files = [photo(), photo()], writes = [], saved = new Map();
  let submit, selected = files, cleared = false, failWrite = true;
  const form = { addEventListener(event, handler) { assert.equal(event, 'submit'); submit = handler; } };
  const input = { value: 'Фото дефекта', focus() {} }, picker = { value: '' };
  const nodes = { chatForm: form, chatInput: input, chatPhotoInput: picker, chatUrgent: { checked: false } };
  Object.assign(context, {
    $: id => nodes[id] || null,
    document: { querySelector: () => null },
    chatComposer: {
      getFiles: () => selected, setBusy() {}, setStatus() {},
      clear() { cleared = true; selected = []; input.value = ''; },
    },
    profileName: 'Сотрудник', state: { role: 'warehouse' }, chatReplyTo: null, knownChatPeople: [],
    pendingGroupMessages: new Map(), chatMessages: [],
    renderChatMessages() {}, cancelChatReply() {}, toast() {},
    console: { error() {} },
    serverTimestamp: () => ({ timestamp: 'stable-sentinel' }),
    db: {}, doc: (_db, ...parts) => parts.join('/'),
    async setDoc(ref, message) {
      writes.push(ref);
      if (failWrite) { failWrite = false; throw new Error('message temporarily unavailable'); }
      saved.set(ref, structuredClone(message));
    },
    getDocFromServer: async ref => ({ exists: () => saved.has(ref), data: () => saved.get(ref) }),
  });
  const begin = source.indexOf('let chatSending=false,pendingGroupDraft=null;');
  const finish = source.indexOf('\n}\n\nasync function loadShipmentCategoryMap', begin);
  assert.ok(begin >= 0 && finish > begin, 'Missing actual shared-chat submit boundary');
  vm.runInContext(source.slice(begin, finish), context);
  await submit({ preventDefault() {} });
  assert.equal(cleared, false, 'a failed message save must retain the text and selected photographs');
  assert.equal(uploadPaths(app).length, 2);
  await submit({ preventDefault() {} });
  assert.equal(cleared, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0], writes[1], 'both submits must target the same immutable message');
  assert.equal(uploadPaths(app).length, 2, 'the second submit must not send either photo to Storage again');
  assert.equal(saved.size, 1);
});
