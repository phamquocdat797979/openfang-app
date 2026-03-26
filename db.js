/**
 * db.js — Sử dụng node:sqlite (built-in Node.js 22.5+ / stable Node.js 24)
 * Không cần cài thêm package nào.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'openfang.db');

// Tạo thư mục nếu chưa tồn tại (cho Railway volume /data/)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL mode = tốc độ cao hơn
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ===== TABLES =====
db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    desc TEXT NOT NULL,
    example TEXT DEFAULT '',
    icon TEXT DEFAULT '⚡',
    builtin INTEGER DEFAULT 0,
    system_instruction TEXT DEFAULT '',
    triggers TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    category TEXT NOT NULL,
    desc TEXT DEFAULT '',
    skill_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT DEFAULT 'running',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    used_skill TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shared_memory (
    id INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
`);

// ===== SEED BUILT-IN SKILLS =====
const BUILTIN_SKILLS = [
  {
    id: 'skill_double',
    name: 'Nhân Đôi Số Nguyên',
    category: 'MATH',
    desc: 'Nhân đôi một số nguyên bất kỳ. Ví dụ: nhận vào 5 và trả về 10.',
    example: '"nhân đôi 7" → "Kết quả: 14"',
    icon: '✖️',
    builtin: 1,
    system_instruction: 'Skill của bạn: Nhân Đôi Số Nguyên. Tìm số nguyên trong câu, nhân đôi và trả lời. Format: "🔢 Kết quả nhân đôi: [số gốc] × 2 = [kết quả]"',
    triggers: JSON.stringify(['nhân đôi', 'gấp đôi', 'double', 'x2', 'nhân 2', 'times 2']),
  },
  {
    id: 'skill_uppercase',
    name: 'Chuyển Đổi Chữ In Hoa',
    category: 'TEXT',
    desc: 'Chuyển đổi chữ thường thành chữ in hoa toàn bộ.',
    example: '"chuyển in hoa: hello world" → "HELLO WORLD"',
    icon: '🔤',
    builtin: 1,
    system_instruction: 'Skill của bạn: Chuyển Đổi Chữ In Hoa. Format: "🔤 Kết quả chuyển đổi:\\n[VĂN BẢN IN HOA]"',
    triggers: JSON.stringify(['chuyển in hoa', 'uppercase', 'in hoa', 'viết hoa', 'chữ hoa', 'to uppercase']),
  },
  {
    id: 'skill_summarize',
    name: 'Tóm Tắt Văn Bản',
    category: 'AI',
    desc: 'Tóm tắt một đoạn văn bản dài thành bản ngắn gọn, súc tích.',
    example: '"tóm tắt: [đoạn văn]" → "[bản tóm tắt]"',
    icon: '📝',
    builtin: 1,
    system_instruction: 'Skill của bạn: Tóm Tắt Văn Bản. Format: "📝 **Tóm tắt:**\\n[2-4 câu]\\n\\n**Ý chính:**\\n• [ý 1]\\n• [ý 2]\\n• [ý 3]"',
    triggers: JSON.stringify(['tóm tắt', 'summarize', 'tóm lược', 'tổng hợp', 'summary']),
  },
];

const insertSkill = db.prepare(`
  INSERT OR IGNORE INTO skills (id, name, category, desc, example, icon, builtin, system_instruction, triggers)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const s of BUILTIN_SKILLS) {
  insertSkill.run(s.id, s.name, s.category, s.desc, s.example, s.icon, s.builtin, s.system_instruction, s.triggers);
}

console.log(`[SQLite] Database: ${DB_PATH}`);
module.exports = db;
