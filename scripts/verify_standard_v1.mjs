import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const parseCliArgs = () => Object.fromEntries(
  process.argv
    .slice(2)
    .filter((item) => item.startsWith('--'))
    .map((item) => {
      const [k, ...rest] = item.slice(2).split('=');
      return [k, rest.join('=') || 'true'];
    })
);

export const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

export const parseVerifyArgs = ({
  defaultTaskId,
  defaultBaseUrl,
  defaultOutputSuffix,
  defaultSampleName
}) => {
  const args = parseCliArgs();
  const taskId = args.task_id || defaultTaskId;
  const baseUrl = args.base_url || defaultBaseUrl;
  const sampleName = args.sample || defaultSampleName;
  const output = args.output
    || path.join(REPO_ROOT, 'rules', 'task-reports', new Date().toISOString().slice(0, 7), `${taskId}_${defaultOutputSuffix}.json`);
  const spawnServer = args.spawn_server !== 'false';
  return { taskId, baseUrl, sampleName, output, spawnServer };
};

export const buildStandardResult = ({
  scriptName,
  taskId,
  sampleName,
  pass,
  message,
  firstBreakLayer = null,
  evidenceFile,
  summary = {},
  rawExcerpt = {}
}) => ({
  script_name: scriptName,
  task_id: taskId,
  sample_name: sampleName,
  pass: pass === true,
  message,
  first_break_layer: firstBreakLayer ?? null,
  evidence_file: evidenceFile,
  summary,
  raw_excerpt: rawExcerpt,
  generated_at: new Date().toISOString()
});

export const writeStandardLog = (outputPath, standardResult) => {
  const logPath = outputPath.replace(/\.json$/i, '.log');
  const lines = [
    `script_name=${standardResult.script_name}`,
    `task_id=${standardResult.task_id}`,
    `sample_name=${standardResult.sample_name}`,
    `pass=${standardResult.pass}`,
    `first_break_layer=${standardResult.first_break_layer ?? 'null'}`,
    `message=${standardResult.message}`
  ].join('\n');
  fs.writeFileSync(logPath, lines);
  return logPath;
};
