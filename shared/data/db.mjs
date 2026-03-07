// SQLite 数据库封装（共享 promise-based API）
// 复用 OppRadar 的 SQLite 连接逻辑

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let sqlite3;
try {
  sqlite3 = require('sqlite3');
} catch (e) {
  // CI fallback: no sqlite3 binary
}

const DB_DIR = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar.sqlite');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let _db = null;

function getRawDb() {
  if (_db) return _db;

  if (sqlite3) {
    _db = new sqlite3.Database(DB_PATH);
    _db.run('PRAGMA busy_timeout = 5000');
  } else {
    // Mock DB for CI
    _db = {
      run(sql, params, cb) {
        const callback = typeof params === 'function' ? params : cb;
        if (callback) callback(null);
      },
      all(sql, params, cb) {
        const callback = typeof params === 'function' ? params : cb;
        if (callback) callback(null, []);
      },
      exec(sql, cb) {
        if (cb) cb(null);
      },
    };
  }
  return _db;
}

/**
 * Returns a promise-based DB handle with exec/run/all
 */
export async function getDb() {
  const raw = getRawDb();
  return {
    exec(sql) {
      return new Promise((resolve, reject) => {
        raw.exec(sql, (err) => err ? reject(err) : resolve());
      });
    },
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
  };
}
