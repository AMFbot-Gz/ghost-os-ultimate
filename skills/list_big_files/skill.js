// Skill: list_big_files — Liste les N fichiers les plus lourds d'un dossier
import { execSync } from "child_process";

export async function run({ dir = ".", limit = 10 }) {
  try {
    const out = execSync(
      `find ${dir} -not -path "*/node_modules/*" -not -path "*/.git/*" -type f -exec du -sh {} + 2>/dev/null | sort -rh | head -${limit}`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return { success: true, result: out.trim() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
