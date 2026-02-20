import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const taskId = '260221_002h';
const evidenceDir = __dirname;

const readJson = (filePath) => {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : {};
};

const setProp = (obj, key, value) => {
    obj[key] = value;
};

const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const base = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
const mergeBase = execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
const generatedAt = new Date().toISOString();

const dodPath = path.join(evidenceDir, `dod_evidence_${taskId}.txt`);
const dodContent = [
    `Task: ${taskId} (Evidence Contract table and Troubleshooting Playbook docs update)`,
    `Branch: ${branch}`,
    `HEAD: ${commit}`,
    `Base(origin/main): ${base}`,
    `MergeBase: ${mergeBase}`,
    `GeneratedAt: ${generatedAt}`
].join('\n');
fs.writeFileSync(dodPath, dodContent);

const gitMetaPath = path.join(evidenceDir, `git_meta_${taskId}.json`);
const gitMeta = readJson(gitMetaPath);
setProp(gitMeta, 'task_id', taskId);
setProp(gitMeta, 'branch', branch);
setProp(gitMeta, 'commit', commit);
setProp(gitMeta, 'base', base);
setProp(gitMeta, 'mergeBase', mergeBase);
setProp(gitMeta, 'generatedAt', generatedAt);
fs.writeFileSync(gitMetaPath, JSON.stringify(gitMeta, null, 2));

const resultPath = path.join(evidenceDir, `result_${taskId}.json`);
const result = readJson(resultPath);
setProp(result, 'task_id', taskId);
setProp(result, 'branch', branch);
setProp(result, 'commit', commit);
setProp(result, 'base', base);
setProp(result, 'mergeBase', mergeBase);
setProp(result, 'generatedAt', generatedAt);
setProp(result, 'status', 'IN_PROGRESS');
setProp(result, 'summary', 'Evidence Contract table and Troubleshooting Playbook docs update');
setProp(result, 'report_file', `notify_${taskId}.txt`);
setProp(result, 'updatedAt', generatedAt);
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

const expectedPaths = [dodPath, gitMetaPath, resultPath];
const missingPaths = expectedPaths.filter((p) => !fs.existsSync(p));
if (missingPaths.length > 0) {
    missingPaths.forEach((p) => console.error(`Missing file: ${path.resolve(p)}`));
    process.exit(1);
}
