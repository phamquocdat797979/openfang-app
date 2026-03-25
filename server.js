const express = require('express');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ===== GEMINI PROXY ENDPOINT =====
// API key stays on the server — never exposed to browser
app.post('/api/gemini', async (req, res) => {
  const { model, systemInstruction, userMessage, generationConfig } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY chưa được cấu hình trên server.' });
  }

  if (!model || !userMessage) {
    return res.status(400).json({ error: 'Thiếu tham số: model hoặc userMessage.' });
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction || 'You are a helpful assistant.' }]
        },
        contents: [
          { role: 'user', parts: [{ text: userMessage }] }
        ],
        generationConfig: generationConfig || {
          temperature: 0.7,
          maxOutputTokens: 1024,
        }
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const errMsg = data?.error?.message || `Gemini API HTTP ${geminiRes.status}`;
      console.error(`[Gemini Error] ${errMsg}`);
      return res.status(geminiRes.status).json({ error: errMsg });
    }

    res.json(data);
  } catch (err) {
    console.error(`[Server Error] ${err.message}`);
    res.status(500).json({ error: `Lỗi server: ${err.message}` });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: 'gemini-2.5-flash',
    timestamp: new Date().toISOString(),
  });
});

// Catch-all: serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ OpenFang Server đang chạy tại http://localhost:${PORT}`);
  console.log(`   Gemini API Key: ${process.env.GEMINI_API_KEY ? '✓ Đã cấu hình' : '✗ CHƯA cấu hình!'}`);
  console.log(`   Môi trường: ${process.env.NODE_ENV || 'development'}\n`);
});
