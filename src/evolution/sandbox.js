import { execa } from 'execa';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export async function evaluateSkill(skillPath, testParams = {}) {
  const testFile = join(tmpdir(), `laruche_skill_test_${Date.now()}.mjs`);
  const testCode = `
import { run } from '${skillPath}';
const result = await run(${JSON.stringify(testParams)});
process.stdout.write(JSON.stringify(result));
`;
  try {
    writeFileSync(testFile, testCode, 'utf8');
    const { stdout, stderr } = await execa('node', ['--experimental-vm-modules', testFile], {
      timeout: 30000,
      env: { ...process.env, NO_NETWORK: '1' },
      reject: false,
    });
    const result = stdout ? JSON.parse(stdout) : { success: false, error: stderr };
    return {
      functionalScore: result.success ? 1.0 : 0.0,
      safetyScore: 0.8, // Default
      performanceScore: 0.7,
      result,
      passed: result.success === true,
    };
  } catch (e) {
    return { functionalScore: 0, safetyScore: 0, performanceScore: 0, result: { success: false, error: e.message }, passed: false };
  } finally {
    try { if (existsSync(testFile)) unlinkSync(testFile); } catch {}
  }
}
