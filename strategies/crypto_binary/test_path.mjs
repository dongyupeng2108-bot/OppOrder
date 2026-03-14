
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiPath = resolve(__dirname, '..', '..', 'ui');
const targetFile = resolve(uiPath, 'strategy-editor.html');

console.log('__dirname:', __dirname);
console.log('uiPath:', uiPath);
console.log('targetFile:', targetFile);
console.log('Exists:', existsSync(targetFile));
