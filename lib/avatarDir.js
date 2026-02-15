import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isServerless = __dirname.startsWith('/var/task') || process.env.VERCEL === '1';
export const avatarDir = isServerless
  ? path.join(os.tmpdir(), 'leasepilot-uploads', 'avatars')
  : path.join(__dirname, '..', 'uploads', 'avatars');
// #region agent log
(function(){const p=path.join(__dirname,'..','.cursor','debug.log');const payload={location:'lib/avatarDir.js',message:'avatarDir resolved',data:{avatarDir,isServerless,__dirname},timestamp:Date.now(),hypothesisId:'H1'};if(process.env.NODE_ENV!=='production')console.error('[avatar]',payload.location,payload.data);try{fs.mkdirSync(path.dirname(p),{recursive:true});fs.appendFileSync(p,JSON.stringify(payload)+'\n');}catch(e){}try{fetch('http://127.0.0.1:7249/ingest/883d00fc-6419-4636-bf2d-d40db9bb5ee7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});}catch(e){}}());
// #endregion

export function ensureAvatarDir() {
  try {
    fs.mkdirSync(avatarDir, { recursive: true });
  } catch (e) {}
}
