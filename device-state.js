// Complete generations only: a failed snapshot never replaces the last good one.
const DIR='nxi-device-state', POINTER='current.json', CHUNK=1024*1024, LIMIT=512*1024*1024;
const LOCK='nxi-device-state-v1';
let active=null, lastStamp=null, restoreFailed=false, restoredGeneration;
// A PWA window and a browser tab share this origin's OPFS. Serialize commits and
// hold a shared lock while restoring so cleanup cannot remove a generation in use.
async function withLock(mode, action){
 if(!navigator.locks?.request)throw Error('This browser cannot safely coordinate saved progress. Use an updated Safari or Chrome.');
 return navigator.locks.request(LOCK,{mode},action);
}
async function directory(){return(await navigator.storage.getDirectory()).getDirectoryHandle(DIR,{create:true});}
async function readJson(dir,name,max=4*1024*1024){const file=await(await dir.getFileHandle(name)).getFile();if(file.size>max)throw Error('Saved device metadata is too large.');return JSON.parse(await file.text());}
async function writeJson(dir,name,value){const writer=await(await dir.getFileHandle(name,{create:true})).createWritable();try{await writer.write(JSON.stringify(value));await writer.close();}catch(e){try{await writer.abort();}catch{}throw e;}}
async function current(dir){try{const r=await readJson(dir,POINTER,4096);if(r.version!==1||!/^[a-f0-9]{32}$/.test(r.generation))throw Error('Invalid device snapshot pointer.');return r;}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
function validate(manifest){
 if(manifest?.version!==1||!Array.isArray(manifest.files)||manifest.files.length>10000)throw Error('Invalid device snapshot.');
 let total=0;const seen=new Set();
 for(const f of manifest.files){if(typeof f.path!=='string'||f.path.length>2048||seen.has(f.path)||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/i.test(f.sha256))throw Error('Invalid device snapshot entry.');seen.add(f.path);total+=f.size;if(total>LIMIT)throw Error('Device snapshot exceeds the 512 MiB limit.');}
}
export async function restoreDeviceState(api,report=()=>{}){
 try{return await withLock('shared',()=>restore(api,report));}catch(error){restoreFailed=true;throw error;}
}
async function restore(api,report){
 const dir=await directory(),pointer=await current(dir);if(!pointer){restoredGeneration=null;return false;}
 const generation=await dir.getDirectoryHandle(pointer.generation),manifest=await readJson(generation,'manifest.json');validate(manifest);
 report('Restoring saved device data…');await api.BeginDeviceRestore();
 try{
  for(let i=0;i<manifest.files.length;i++){
   const item=manifest.files[i],file=await(await generation.getFileHandle(String(i))).getFile();if(file.size!==item.size)throw Error('Saved device data is incomplete.');
   let offset=0;do{const bytes=new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer());await api.WriteDeviceRestore(item.path,offset,bytes);offset+=bytes.byteLength;}while(offset<item.size);
  }
  await api.CommitDeviceRestore(JSON.stringify(manifest));restoredGeneration=pointer.generation;return true;
 }catch(error){await api.AbortDeviceRestore().catch(()=>{});throw error;}
}
export function saveDeviceState(api,{force=false,report=()=>{}}={}){
 if(active)return active;
 active=withLock('exclusive',()=>save(api,force,report)).finally(()=>{active=null;});return active;
}
async function save(api,force,report){
 if(restoreFailed)throw Error("The existing saved snapshot is preserved. Reload and resolve the restore error before replacing device data.");
 const stamp=await api.DeviceStateStamp();if(stamp===null||!force&&stamp===lastStamp)return false;
 const dir=await directory(),previous=await current(dir),id=crypto.randomUUID().replaceAll('-','');
 // Locking alone is insufficient: a tab may have loaded an older generation
 // before another window saved. Never replace newer progress with that stale copy.
 if((previous?.generation??null)!==(restoredGeneration??null))
  throw Error('Saved progress changed in another Mochi window. The newer save is preserved. Reload this window before playing or saving again.');
 let begun=false,writer;
 try{
  const encoded=await api.BeginDeviceSnapshot();begun=true;
  const manifest=JSON.parse(encoded);validate(manifest);
  const estimate=await navigator.storage.estimate?.(),total=manifest.files.reduce((n,f)=>n+f.size,0);
  if(estimate?.quota&&total>estimate.quota-(estimate.usage||0))throw Error('Not enough device storage to save progress.');
  report('Saving progress on this device…');
  const generation=await dir.getDirectoryHandle(id,{create:true});
  for(let i=0;i<manifest.files.length;i++){
   const item=manifest.files[i];writer=await(await generation.getFileHandle(String(i),{create:true})).createWritable();
   let offset=0;do{const bytes=await api.ReadDeviceSnapshot(item.path,offset);if(bytes.byteLength>CHUNK||offset+bytes.byteLength>item.size||bytes.byteLength===0&&offset<item.size)throw Error('Device snapshot transfer failed.');await writer.write(bytes);offset+=bytes.byteLength;}while(offset<item.size);
   await writer.close();writer=null;
  }
  await api.EndDeviceSnapshot(true);begun=false;
  await writeJson(generation,'manifest.json',manifest);await writeJson(dir,POINTER,{version:1,generation:id});
  lastStamp=stamp;restoredGeneration=id;
  // Remove only the generation this successful commit replaced.
  if(previous&&previous.generation!==id)try{await dir.removeEntry(previous.generation,{recursive:true});}catch{}
  report('Progress saved on this device.');return true;
 }catch(error){
  try{await writer?.abort();}catch{}
  if(begun)await api.EndDeviceSnapshot(false).catch(()=>{});
  try{await dir.removeEntry(id,{recursive:true});}catch{}
  throw error;
 }
}
