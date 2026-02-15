import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isServerless = __dirname.startsWith('/var/task') || process.env.VERCEL === '1';
export const avatarDir = isServerless
  ? path.join(os.tmpdir(), 'leasepilot-uploads', 'avatars')
  : path.join(__dirname, '..', 'uploads', 'avatars');

export function ensureAvatarDir() {
  try {
    fs.mkdirSync(avatarDir, { recursive: true });
  } catch (e) {}
}
