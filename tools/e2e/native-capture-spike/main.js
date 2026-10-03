import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

const origin = 'http://127.0.0.1:3015';
const result = document.querySelector('#result');
const show = value => { result.textContent = JSON.stringify(value, null, 2); };
const act = work => async () => { try { await work(); } catch (error) { show({ error: String(error) }); } };
show({ platform: Capacitor.getPlatform(), native: Capacitor.isNativePlatform() });
document.querySelector('#session').onclick = act(async () => {
  const response = await CapacitorHttp.get({ url: origin + '/api/auth/me' });
  show({ status: response.status, signedIn: response.status === 200 && response.data.profile?.id === localStorage.getItem('fixture-profile') });
});
document.querySelector('#login').onclick = act(async () => {
  const login = await CapacitorHttp.get({ url: origin + '/fixture/native-login' });
  localStorage.setItem('fixture-profile', login.data.profileId);
  const response = await CapacitorHttp.get({ url: origin + '/api/auth/me' });
  show({ status: response.status, signedIn: response.status === 200 && response.data.profile?.id === login.data.profileId });
});
let selectedUri, recordedBlob, requestId, uploadTicket;
document.querySelector('#photo').onclick = act(async () => {
  const selection = await Camera.chooseFromGallery({ allowMultipleSelection: false });
  const photo = selection.results[0];
  if (!photo) { show({ photo: 'canceled' }); return; }
  selectedUri = photo.uri;
  const image = document.querySelector('#image'); image.src = Capacitor.convertFileSrc(photo.uri); image.hidden = false;
  show({ photo: 'selected', preview: Boolean(photo.uri) });
});
document.querySelector('#share').onclick = act(async () => {
  if (selectedUri) {
    const file = await Filesystem.readFile({ path: selectedUri });
    const saved = await Filesystem.writeFile({ path: 'waka-fixture-photo.jpg', data: file.data, directory: Directory.Cache });
    await Share.share({ title: 'WAKA fixture', files: [saved.uri] });
  } else await Share.share({ title: 'WAKA fixture', text: 'Leave room for what matters.' });
  show({ shareSheet: 'returned' });
});
document.querySelector('#record').onclick = act(async () => {
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { show({ recording: 'unsupported' }); return; }
  const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
  oscillator.frequency.value = 220; oscillator.connect(destination); oscillator.start();
  const recorder = new MediaRecorder(destination.stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  recorder.onstop = async () => {
    oscillator.stop(); destination.stream.getTracks().forEach(track => track.stop()); await context.close();
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    recordedBlob = blob; requestId = crypto.randomUUID(); uploadTicket = null;
    const audio = document.querySelector('#audio'); audio.src = URL.createObjectURL(blob); audio.hidden = false;
    show({ recording: 'ready', mimeType: blob.type, bytes: blob.size });
  };
  recorder.start(); show({ recording: 'synthetic tone', mimeType });
  setTimeout(() => recorder.stop(), 2000);
});
document.querySelector('#upload').onclick = act(async () => {
  if (!recordedBlob) { show({ upload: 'record first' }); return; }
  const extension = recordedBlob.type.includes('mp4') ? 'm4a' : 'webm';
  const profile = localStorage.getItem('fixture-profile');
  if (!profile) { show({ upload: 'sign in to the fixture first' }); return; }
  const signed = uploadTicket ?? await CapacitorHttp.post({ url: origin + '/api/attachments/presign?profile=' + encodeURIComponent(profile), headers: { 'Content-Type': 'application/json' },
    data: { filename: `Native.${extension}`, contentType: recordedBlob.type, size: recordedBlob.size } });
  if (signed.status !== 200) { show({ presignStatus: signed.status }); return; }
  if (signed.data.profileId !== profile) { show({ upload: 'profile changed' }); return; }
  uploadTicket = signed;
  // The iOS patched fetch rejected this Blob with CapacitorUrlRequestError.
  // Use the documented native file encoding rather than relying on coercion.
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(recordedBlob);
  });
  const uploaded = await CapacitorHttp.request({ url: signed.data.uploadUrl, method: 'PUT',
    headers: signed.data.headers, data: base64, dataType: 'file' });
  if (uploaded.status < 200 || uploaded.status >= 300) { show({ uploadStatus: uploaded.status }); return; }
  const saved = await CapacitorHttp.post({ url: origin + '/api/inspirations', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
    data: { text: '', kind: 'audio', attachments: [{ type: 'audio', key: signed.data.key, contentType: recordedBlob.type, size: recordedBlob.size, name: `Native.${extension}` }] } });
  show({ saveStatus: saved.status, attachmentCount: saved.data.inspiration?.attachments?.length, code: saved.data.code });
});
