/**
 * skills/clipboard/skill.js
 * Lecture et écriture du presse-papiers macOS via pbcopy/pbpaste
 */
import { execSync, spawnSync } from 'child_process';

export async function run({ action = 'read', text = '', timeout = 5000 } = {}) {
  switch (action) {
    case 'read': {
      try {
        const content = execSync('pbpaste', { encoding: 'utf-8', timeout });
        return { success: true, action, content: content.slice(0, 2000), length: content.length };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    case 'write':
    case 'copy': {
      if (!text) return { success: false, error: 'text requis pour écrire dans le presse-papiers' };
      const result = spawnSync('pbcopy', [], { input: text, encoding: 'utf-8', timeout });
      if (result.error) return { success: false, error: result.error.message };
      return { success: result.status === 0, action, message: `${text.length} caractères copiés dans le presse-papiers` };
    }
    default:
      return { success: false, error: `Action inconnue: ${action}. Valides: read, write` };
  }
}
