/**
 * skills/organise_screenshots/skill.js
 * Organise les screenshots macOS par date (YYYY-MM) dans ~/Pictures/Screenshots
 */
import { readdirSync, mkdirSync, renameSync, existsSync, statSync } from 'fs';
import { join, homedir } from 'path';

export async function run(params = {}) {
  const src_dir = params.dir || join(homedir(), 'Desktop');
  if (!existsSync(src_dir)) {
    return { success: false, error: `Dossier introuvable: ${src_dir}` };
  }

  const dest_root = params.dest || join(homedir(), 'Pictures', 'Screenshots');
  const moved = [];
  const skipped = [];

  // Patterns de noms de screenshots macOS : "Capture d'écran YYYY-MM-DD..."
  const entries = readdirSync(src_dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const is_screenshot =
      entry.name.startsWith("Capture d'écran") ||
      entry.name.startsWith('Screenshot') ||
      entry.name.match(/^Screen Shot \d{4}/);
    if (!is_screenshot) continue;

    const full_path = join(src_dir, entry.name);
    const mtime = statSync(full_path).mtime;
    const month_dir = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}`;
    const dest_dir = join(dest_root, month_dir);
    mkdirSync(dest_dir, { recursive: true });

    const dst = join(dest_dir, entry.name);
    if (existsSync(dst)) { skipped.push(entry.name); continue; }
    renameSync(full_path, dst);
    moved.push({ file: entry.name, month: month_dir });
  }

  return {
    success: true,
    moved: moved.length,
    skipped: skipped.length,
    details: moved,
    dest_root,
  };
}
