/**
 * skills/organise_telechargements/skill.js
 * Organise le dossier ~/Downloads par type de fichier (images, vidéos, docs, archives, code)
 */
import { readdirSync, mkdirSync, renameSync, existsSync, statSync } from 'fs';
import { join, extname, homedir } from 'path';

const CATEGORIES = {
  images:   ['.jpg','.jpeg','.png','.gif','.webp','.svg','.heic','.bmp','.tiff'],
  videos:   ['.mp4','.mov','.avi','.mkv','.webm','.m4v','.wmv'],
  docs:     ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.md','.pages','.numbers'],
  archives: ['.zip','.tar','.gz','.rar','.7z','.dmg','.pkg'],
  audio:    ['.mp3','.wav','.flac','.aac','.m4a','.ogg'],
  code:     ['.js','.ts','.py','.sh','.json','.yaml','.yml','.toml','.rb','.go','.rs'],
};

export async function run(params = {}) {
  const downloads_dir = params.dir || join(homedir(), 'Downloads');
  if (!existsSync(downloads_dir)) {
    return { success: false, error: `Dossier introuvable: ${downloads_dir}` };
  }

  const moved = [];
  const skipped = [];
  const entries = readdirSync(downloads_dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    const category = Object.entries(CATEGORIES).find(([, exts]) => exts.includes(ext))?.[0] || 'autres';
    const dest_dir = join(downloads_dir, category);
    mkdirSync(dest_dir, { recursive: true });
    const src = join(downloads_dir, entry.name);
    const dst = join(dest_dir, entry.name);
    if (existsSync(dst)) { skipped.push(entry.name); continue; }
    renameSync(src, dst);
    moved.push({ file: entry.name, category });
  }

  return {
    success: true,
    moved: moved.length,
    skipped: skipped.length,
    details: moved,
    dir: downloads_dir,
  };
}
