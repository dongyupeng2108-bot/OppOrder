// db.mjs — BTCQDD 独立 SQLite 数据库连接
// 与 OppRadar 的 shared/data/db.mjs 完全独立
// 默认路径：data/crypto_binary/btcqdd.sqlite
// 支持 config.database.path 配置化（v1.4 §4.6）

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DEFAULT_DB_PATH = 'data/crypto_binary/btcqdd.sqlite';

let _wrapper = null;
let _dbPath = null;

/**
 * 获取数据库连接（单例）
 * @param {string} [dbPath] — 可选路径，优先于默认值
 */
export async function getDb(dbPath) {
  const resolvedPath = dbPath || _dbPath || DEFAULT_DB_PATH;

  if (_wrapper && _dbPath === resolvedPath) return _wrapper;

  // 确保目录存在
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const raw = new Database(resolvedPath);
  raw.pragma('journal_mode = WAL');
  _dbPath = resolvedPath;

  // 封装为 async API（与 shared/data/db.mjs 接口兼容）
  _wrapper = {
    run: (sql, params = []) => Promise.resolve(raw.prepare(sql).run(...params)),
    all: (sql, params = []) => Promise.resolve(raw.prepare(sql).all(...params)),
    get: (sql, params = []) => Promise.resolve(raw.prepare(sql).get(...params)),
    exec: (sql) => Promise.resolve(raw.exec(sql)),
  };

  return _wrapper;
}

/**
 * 从 config 对象初始化数据库路径
 * strategy_runner 启动时调用一次
 */
export function initDbPath(config) {
  _dbPath = config?.database?.path || DEFAULT_DB_PATH;
  _wrapper = null; // 重置连接，下次 getDb() 时重新建立
  console.log(`[DB] path=${_dbPath}`);
}
