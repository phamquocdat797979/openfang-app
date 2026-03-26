const express = require('express');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3456;
const db = require('./db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===========================
// GEMINI PROXY
// ===========================
app.post('/api/gemini', async (req, res) => {
  const { model, systemInstruction, userMessage, generationConfig } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY chưa được cấu hình.' });
  if (!model || !userMessage) return res.status(400).json({ error: 'Thiếu model hoặc userMessage.' });

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction || '' }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: generationConfig || { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    });
    const data = await geminiRes.json();
    if (!geminiRes.ok) return res.status(geminiRes.status).json({ error: data?.error?.message || 'Gemini error' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// SKILLS API
// ===========================
app.get('/api/skills', (req, res) => {
  try {
    const skills = db.prepare('SELECT * FROM skills ORDER BY builtin DESC, name ASC').all();
    res.json(skills.map(s => ({
      id: s.id, name: s.name, category: s.category, desc: s.desc,
      example: s.example, icon: s.icon, builtin: !!s.builtin,
      systemInstruction: s.system_instruction,
      triggers: JSON.parse(s.triggers || '[]'),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/skills', (req, res) => {
  try {
    const { id, name, category, desc, example, icon, systemInstruction, triggers } = req.body;
    db.prepare(`INSERT INTO skills (id, name, category, desc, example, icon, builtin, system_instruction, triggers)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(id, name, category, desc, example || '', icon || '⚡', systemInstruction || `Skill: ${name}. ${desc}`, JSON.stringify(triggers || []));
    res.json({ id, name, category, desc, example, icon, builtin: false, systemInstruction, triggers: triggers || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/skills/:id', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM skills WHERE id = ? AND builtin = 0').run(req.params.id);
    if (info.changes === 0) return res.status(403).json({ error: 'Không thể xóa skill hệ thống hoặc skill không tồn tại.' });
    
    const agents = db.prepare('SELECT id, skill_ids FROM agents').all();
    const updateAgent = db.prepare('UPDATE agents SET skill_ids = ? WHERE id = ?');
    for (const a of agents) {
      let ids = JSON.parse(a.skill_ids || '[]');
      if (ids.includes(req.params.id)) {
        ids = ids.filter(i => i !== req.params.id);
        updateAgent.run(JSON.stringify(ids), a.id);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================
// AGENTS API
// ===========================
app.get('/api/agents', (req, res) => {
  try {
    const agents = db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all();
    const countMsg = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE agent_id = ?');
    res.json(agents.map(a => ({
      id: a.id, name: a.name, model: a.model, category: a.category,
      desc: a.desc, status: a.status, createdAt: a.created_at,
      skillIds: JSON.parse(a.skill_ids || '[]'),
      messageCount: countMsg.get(a.id)?.cnt || 0,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/agents', (req, res) => {
  try {
    const { id, name, model, category, desc, skillIds } = req.body;
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO agents (id, name, model, category, desc, skill_ids, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`)
      .run(id, name, model, category, desc || '', JSON.stringify(skillIds || []), createdAt);
    res.json({ id, name, model, category, desc, skillIds: skillIds || [], status: 'running', createdAt, messageCount: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/agents/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM messages WHERE agent_id = ?').run(req.params.id);
    db.prepare('DELETE FROM shared_memory WHERE agent_id = ?').run(req.params.id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================
// MESSAGES API
// ===========================
app.get('/api/agents/:id/messages', (req, res) => {
  try {
    const msgs = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY id ASC').all(req.params.id);
    res.json(msgs.map(m => ({
      role: m.role, content: m.content,
      usedSkill: m.used_skill || null, timestamp: m.timestamp,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/agents/:id/messages', (req, res) => {
  try {
    const { messages } = req.body;
    const insert = db.prepare(`INSERT INTO messages (agent_id, role, content, used_skill, timestamp)
                               VALUES (?, ?, ?, ?, ?)`);
    const msgs = Array.isArray(messages) ? messages : [messages];
    db.exec('BEGIN TRANSACTION');
    for (const m of msgs) {
      insert.run(req.params.id, m.role, m.content, m.usedSkill || null, m.timestamp);
    }
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================
// SHARED MEMORY API
// ===========================
app.get('/api/memory', (req, res) => {
  try {
    const memory = db.prepare('SELECT * FROM shared_memory ORDER BY id ASC').all();
    res.json(memory.map(m => ({
      agentId: m.agent_id, agentName: m.agent_name,
      type: m.type, content: m.content, timestamp: m.timestamp,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Memory from other agents only
app.get('/api/memory/others/:agentId', (req, res) => {
  try {
    const memory = db.prepare(`SELECT * FROM shared_memory WHERE agent_id != ? ORDER BY id ASC`).all(req.params.agentId);
    res.json(memory.map(m => ({
      agentId: m.agent_id, agentName: m.agent_name,
      type: m.type, content: m.content, timestamp: m.timestamp,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/memory', (req, res) => {
  try {
    const { agentId, agentName, type, content } = req.body;
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO shared_memory (agent_id, agent_name, type, content, timestamp)
                VALUES (?, ?, ?, ?, ?)`)
      .run(agentId, agentName, type, content, timestamp);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================
// HEALTH CHECK
// ===========================
app.get('/api/health', (req, res) => {
  const agentCount = db.prepare('SELECT COUNT(*) as cnt FROM agents').get()?.cnt || 0;
  const memCount = db.prepare('SELECT COUNT(*) as cnt FROM shared_memory').get()?.cnt || 0;
  res.json({ status: 'ok', model: 'gemini-2.5-flash', agents: agentCount, memoryEntries: memCount, timestamp: new Date().toISOString() });
});

// Catch-all SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ OpenFang Server tại http://localhost:${PORT}`);
  console.log(`   Gemini API Key: ${process.env.GEMINI_API_KEY ? '✓ Đã cấu hình' : '✗ CHƯA cấu hình!'}`);
  console.log(`   SQLite DB: ${process.env.DB_PATH || 'openfang.db (local)'}\n`);
});
