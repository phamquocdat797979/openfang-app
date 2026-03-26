// ===== STATE (in-memory cache — synced with SQLite on backend) =====
const state = {
  agents: [],        // loaded from DB on init; messages loaded lazily per agent
  skills: [],        // loaded from DB on init
  sharedMemory: [],  // loaded from DB on init, updated in realtime
  logs: [],
  currentChatAgentId: null,
  totalMessages: 0,
  startTime: Date.now(),
};

// ===== API HELPERS =====
async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${path} lỗi ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API ${path} lỗi ${res.status}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API DELETE ${path} lỗi ${res.status}`);
  return res.json();
}

// ===== GEMINI API — calls backend proxy =====
async function callGeminiAPI(systemPrompt, userMessage, model) {
  const apiModel = model || OPENFANG_CONFIG.GEMINI_MODEL;
  const response = await fetch(OPENFANG_CONFIG.API_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: apiModel,
      systemInstruction: systemPrompt,
      userMessage: userMessage,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error || `Server lỗi HTTP ${response.status}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini không trả về nội dung.');
  return text;
}

// Build system prompt from agent skills + other agents' shared memory
function buildAgentSystemPrompt(agent, sharedMemoryContext) {
  const agentSkills = state.skills.filter(s => agent.skillIds.includes(s.id));
  const skillsText = agentSkills.map((s, i) =>
    `${i + 1}. **${s.name}** (${s.category}): ${s.desc}\n   ${s.systemInstruction || ''}`
  ).join('\n\n');

  const memoryText = sharedMemoryContext.length > 0
    ? `\n\n=== SHARED MEMORY (Hoạt động từ các agent khác) ===\n` +
      sharedMemoryContext.slice(-15).map(m => {
        const d = new Date(m.timestamp);
        const timeStr = `${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${d.toLocaleDateString('vi-VN')}`;
        return `[${timeStr}] ${m.agentName}: ${m.content}`;
      }).join('\n')
    : '';

  return `Bạn là ${agent.name}, một AI agent chuyên biệt trong hệ thống OpenFang. Hôm nay là ngày ${new Date().toLocaleDateString('vi-VN')}.

=== SKILLS CỦA BẠN (CHỈ được thực hiện các tác vụ này) ===
${skillsText}

=== QUY TẮC BẮT BUỘC ===
1. Bạn CHỈ được thực hiện các tác vụ trong danh sách skills ở trên.
2. Nếu yêu cầu KHÔNG liên quan đến bất kỳ skill nào, từ chối lịch sự và liệt kê skills.
3. Khi từ chối: "⛔ Xin lỗi, tôi là **${agent.name}** và chỉ có thể thực hiện: [danh sách skills]. Bạn hãy thử lại! 😊"
4. Trả lời bằng tiếng Việt trừ khi người dùng hỏi tiếng Anh.
5. CHỈ KHI người dùng nhắc chính xác TÊN của một agent khác (ví dụ: "Agent A đã làm gì?"), bạn mới được tra cứu Shared Memory và báo cáo hoạt động của riêng agent đó.
6. Nếu người dùng hỏi dò (ví dụ: "ai vừa làm gì", "các agent khác"), hãy TỪ CHỐI tiết lộ thông tin. Bạn phải yêu cầu họ cung cấp đúng tên Agent cần kiểm tra.
7. KHÔNG trả lời câu hỏi chung chung ngoài skills.${memoryText}`;
}

// ===== INIT — Load từ SQLite =====
document.addEventListener('DOMContentLoaded', async () => {
  showLoadingOverlay(true);
  try {
    const [skills, agents, memory] = await Promise.all([
      apiGet('/api/skills'),
      apiGet('/api/agents'),
      apiGet('/api/memory'),
    ]);

    state.skills = skills;
    state.agents = agents.map(a => ({
      ...a,
      messages: [],
      messagesLoaded: false,
      createdAt: new Date(a.createdAt),
    }));
    state.sharedMemory = memory.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
    state.totalMessages = agents.reduce((sum, a) => sum + (a.messageCount || 0), 0);
  } catch (err) {
    console.error('Init error:', err);
    addLog('error', 'DB', `Không thể tải dữ liệu: ${err.message}`);
  }

  showLoadingOverlay(false);
  renderSkillsPage();
  renderSkillsSelector();
  renderAgentsList();
  updateStatusBar();
  updateStats();
  startUptimeTimer();
  navigateTo('chat');
  showGeminiBadge();
  addLog('success', 'DB', `SQLite: ${state.agents.length} agents, ${state.skills.length} skills, ${state.sharedMemory.length} memory entries`);
  addLog('success', 'Gemini', `Proxy server sẵn sàng (${OPENFANG_CONFIG.GEMINI_MODEL})`);

  fetch('/api/health').then(r => r.json()).then(d => {
    addLog('success', 'Server', `Health OK — ${d.agents} agents in DB`);
  }).catch(() => {});
});

function showLoadingOverlay(show) {
  let el = document.getElementById('loadingOverlay');
  if (!el && show) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.style.cssText = `position:fixed;inset:0;background:var(--bg-primary,#0d1117);display:flex;align-items:center;justify-content:center;z-index:9999;flex-direction:column;gap:12px;`;
    el.innerHTML = `<div style="width:32px;height:32px;border:3px solid rgba(255,107,53,.3);border-top-color:#FF6B35;border-radius:50%;animation:spin 0.8s linear infinite"></div><p style="color:#8b91a8;font-size:13px">Đang tải dữ liệu...</p><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  }
  if (el) el.style.display = show ? 'flex' : 'none';
}

function showGeminiBadge() {
  const statusBar = document.querySelector('.agent-status-bar');
  if (!statusBar || document.querySelector('.status-badge.gemini')) return;
  const badge = document.createElement('span');
  badge.className = 'status-badge gemini';
  badge.textContent = 'GEMINI';
  badge.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:.05em;background:rgba(79,142,247,.15);color:#4F8EF7;border:1px solid rgba(79,142,247,.3);border-radius:4px;padding:1px 6px;margin-left:4px;';
  statusBar.appendChild(badge);
}

// ===== NAVIGATION =====
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');
  if (page === 'overview') updateOverviewPage();
  if (page === 'sessions') renderSessionsPage();
  if (page === 'memory') renderMemoryPage();
  if (page === 'logs') renderLogsPage();
  if (page === 'skills') renderSkillsPage();
}

// ===== SKILLS PAGE =====
function renderSkillsPage() {
  const grid = document.getElementById('skillsGrid');
  if (!grid) return;
  grid.innerHTML = state.skills.map(skill => `
    <div class="skill-card" onclick="openSkillDetail('${skill.id}')" style="cursor:pointer">
      <div class="skill-card-header">
        <div class="skill-icon ${skill.category.toLowerCase()}">${skill.icon || '⚡'}</div>
        <span class="skill-badge">${skill.category}</span>
      </div>
      <div class="skill-name">${skill.name}</div>
      <div class="skill-desc">${skill.desc}</div>
      ${skill.example ? `<div class="skill-example">${skill.example}</div>` : ''}
    </div>
  `).join('');
  if (document.getElementById('statSkills'))
    document.getElementById('statSkills').textContent = state.skills.length;
}

function renderSkillsSelector() {
  const container = document.getElementById('skillsSelector');
  if (!container) return;
  container.innerHTML = state.skills.map(skill => `
    <div class="skill-checkbox-item" id="skillsel-${skill.id}" onclick="toggleSkillSelection('${skill.id}')">
      <div class="skill-checkbox"><div class="skill-check-box"></div></div>
      <div class="skill-checkbox-info">
        <div class="skill-checkbox-name">${skill.icon || '⚡'} ${skill.name}</div>
        <div class="skill-checkbox-desc">${skill.desc}</div>
      </div>
    </div>
  `).join('');
}

function toggleSkillSelection(skillId) {
  const el = document.getElementById(`skillsel-${skillId}`);
  if (el) el.classList.toggle('selected');
  document.getElementById('skillsError').style.display = 'none';
}

function getSelectedSkillIds() {
  return state.skills.filter(s => {
    const el = document.getElementById(`skillsel-${s.id}`);
    return el && el.classList.contains('selected');
  }).map(s => s.id);
}

// ===== NEW SKILL MODAL =====
function openNewSkillModal() {
  document.getElementById('skillNameInput').value = '';
  document.getElementById('skillDescInput').value = '';
  document.getElementById('skillExampleInput').value = '';
  document.getElementById('skillPromptInput').value = '';
  document.getElementById('skillTriggersInput').value = '';
  openModal('newSkillModal');
}

async function createSkill() {
  const name = document.getElementById('skillNameInput').value.trim();
  const desc = document.getElementById('skillDescInput').value.trim();
  const category = document.getElementById('skillCategoryInput').value;
  const example = document.getElementById('skillExampleInput').value.trim();
  const prompt = document.getElementById('skillPromptInput').value.trim();
  const triggersText = document.getElementById('skillTriggersInput').value.trim();

  if (!name) { showToast('Vui lòng nhập tên skill!', 'error'); return; }
  if (!desc) { showToast('Vui lòng nhập mô tả skill!', 'error'); return; }

  const triggersArr = triggersText ? triggersText.split(',').map(t => t.trim()).filter(Boolean) : [];
  const finalPrompt = prompt || `Skill của bạn: ${name}. Nhiệm vụ: ${desc}. Hãy thực hiện chính xác nhiệm vụ này dựa trên dữ liệu người dùng cung cấp.`;

  const icons = { MATH: '🔢', TEXT: '📄', AI: '🤖', UTILITY: '⚙️', CUSTOM: '✨' };
  const newSkill = {
    id: `skill_${Date.now()}`, name, category, desc,
    example: example || '', icon: icons[category] || '⚡',
    systemInstruction: finalPrompt, triggers: triggersArr,
  };

  try {
    const saved = await apiPost('/api/skills', newSkill);
    state.skills.push(saved);
    renderSkillsPage(); renderSkillsSelector();
    closeModal('newSkillModal');
    showToast(`Skill "${name}" đã được thêm!`, 'success');
    addLog('success', 'Skills', `Skill mới: "${name}"`);
  } catch (err) {
    showToast(`Lỗi lưu skill: ${err.message}`, 'error');
  }
}

// ===== SKILL DETAIL & DELETE =====
function openSkillDetail(skillId) {
  const skill = state.skills.find(s => s.id === skillId);
  if (!skill) return;

  document.getElementById('skillDetailTitle').textContent = `Skill: ${skill.name}`;
  document.getElementById('deleteSkillBtn').dataset.skillId = skillId;
  document.getElementById('deleteSkillBtn').style.display = skill.builtin ? 'none' : 'block';

  document.getElementById('skillDetailBody').innerHTML = `
    <div class="agent-detail-grid">
      <div class="detail-field"><div class="detail-field-label">TÊN SKILL</div><div class="detail-field-value">${skill.name}</div></div>
      <div class="detail-field"><div class="detail-field-label">DANH MỤC</div><div class="detail-field-value">${skill.category}</div></div>
      <div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">MÔ TẢ</div><div class="detail-field-value">${skill.desc}</div></div>
      ${skill.example ? `<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">VÍ DỤ</div><div class="detail-field-value" style="font-family:var(--font-mono);font-size:12px;color:var(--accent)">${skill.example}</div></div>` : ''}
    </div>
    
    <div class="memory-section">
      <div class="section-title" style="color:#4F8EF7">MÃ KỊCH BẢN (SYSTEM INSTRUCTION)</div>
      <div class="memory-entry" style="font-family:var(--font-mono); white-space:pre-wrap; border-color:#4F8EF7; background:rgba(79,142,247,0.05)">${skill.systemInstruction}</div>
    </div>

    ${skill.triggers && skill.triggers.length > 0 ? `
    <div class="detail-skills-section">
      <div class="section-title">TỪ KHÓA KÍCH HOẠT (TRIGGERS)</div>
      <div class="detail-skills-list">${skill.triggers.map(t => `<span class="detail-skill-tag">${t}</span>`).join('')}</div>
    </div>` : ''}
  `;
  openModal('skillDetailModal');
}

async function deleteCurrentSkill() {
  const skillId = document.getElementById('deleteSkillBtn').dataset.skillId;
  const skill = state.skills.find(s => s.id === skillId);
  if (!skill || skill.builtin) return;

  if (confirm(`Bạn có chắc chắn muốn xóa skill "${skill.name}"?`)) {
    try {
      await apiDelete(`/api/skills/${skillId}`);
      state.skills = state.skills.filter(s => s.id !== skillId);
      // Xóa skill id ra khỏi các agent đang dùng nó
      state.agents.forEach(a => {
        a.skillIds = a.skillIds.filter(id => id !== skillId);
      });
      addLog('warn', 'Skills', `Đã xóa skill: "${skill.name}"`);
      renderSkillsPage(); renderSkillsSelector(); updateOverviewPage();
      closeModal('skillDetailModal');
      showToast(`Skill "${skill.name}" đã bị xóa.`, 'info');
    } catch (err) {
      showToast(`Lỗi xóa skill: ${err.message}`, 'error');
    }
  }
}

// ===== NEW AGENT MODAL =====
function openNewAgentModal() {
  document.getElementById('agentNameInput').value = '';
  document.getElementById('agentDescInput').value = '';
  state.skills.forEach(s => {
    const el = document.getElementById(`skillsel-${s.id}`);
    if (el) el.classList.remove('selected');
  });
  document.getElementById('skillsError').style.display = 'none';
  renderSkillsSelector();
  openModal('newAgentModal');
}

async function createAgent() {
  const name = document.getElementById('agentNameInput').value.trim();
  const model = document.getElementById('agentModelSelect').value;
  const category = document.getElementById('agentCategorySelect').value;
  const desc = document.getElementById('agentDescInput').value.trim();
  const selectedSkillIds = getSelectedSkillIds();

  if (!name) { showToast('Vui lòng nhập tên agent!', 'error'); return; }
  
  // Kiểm tra trùng tên agent
  const isDuplicate = state.agents.some(a => a.name.toLowerCase() === name.toLowerCase());
  if (isDuplicate) {
    showToast(`Tên agent "${name}" đã tồn tại! Vui lòng chọn tên khác.`, 'error');
    return;
  }

  if (selectedSkillIds.length === 0) {
    document.getElementById('skillsError').style.display = 'block';
    showToast('Bắt buộc phải chọn ít nhất 1 skill!', 'error'); return;
  }

  const agentData = {
    id: `agent_${Date.now()}`, name, model, category,
    desc: desc || `Agent ${name} với ${selectedSkillIds.length} skill(s)`,
    skillIds: selectedSkillIds,
  };

  try {
    const saved = await apiPost('/api/agents', agentData);
    const agent = { ...saved, messages: [], messagesLoaded: false, createdAt: new Date(saved.createdAt) };
    state.agents.push(agent);

    await addToSharedMemory(agent.id, agent.name, 'agent_created',
      `Agent "${agent.name}" vừa được tạo với skills: ${getSkillNames(selectedSkillIds).join(', ')}`);

    renderAgentsList(); updateStatusBar(); updateStats();
    closeModal('newAgentModal');
    showToast(`Agent "${name}" đã được tạo!`, 'success');
    addLog('success', 'Agents', `Agent mới: "${name}" (${model})`);
  } catch (err) {
    showToast(`Lỗi tạo agent: ${err.message}`, 'error');
    addLog('error', 'DB', err.message);
  }
}

function getSkillNames(ids) {
  return ids.map(id => { const s = state.skills.find(sk => sk.id === id); return s ? s.name : id; });
}

// ===== RENDER AGENTS =====
function renderAgentsList() {
  const section = document.getElementById('yourAgentsSection');
  const emptyState = document.getElementById('chatEmptyState');
  const list = document.getElementById('agentsList');
  if (!section || !list) return;

  if (state.agents.length === 0) {
    section.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  section.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';

  list.innerHTML = state.agents.map(agent => `
    <div class="agent-item" onclick="openChatWithAgent('${agent.id}')">
      <div class="agent-avatar">${agent.name.charAt(0).toUpperCase()}</div>
      <div class="agent-info">
        <div class="agent-name">${agent.name}</div>
        <div class="agent-model">${agent.model}</div>
      </div>
      <div class="agent-badges">
        <span class="badge badge-${agent.status}">${agent.status.toUpperCase()}</span>
      </div>
      <button class="agent-settings-btn" onclick="event.stopPropagation(); openAgentDetail('${agent.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  `).join('');
}

// ===== SHARED MEMORY =====
async function addToSharedMemory(agentId, agentName, type, content) {
  const entry = { agentId, agentName, type, content, timestamp: new Date() };
  state.sharedMemory.push(entry);
  // Save to DB in background
  apiPost('/api/memory', { agentId, agentName, type, content })
    .catch(err => console.warn('Memory save failed:', err));
}

function getSharedMemoryForAgent(agentId) {
  return state.sharedMemory.filter(m => m.agentId !== agentId);
}

// ===== CHAT =====
let currentAgent = null;

async function openChatWithAgent(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) return;
  currentAgent = agent;
  state.currentChatAgentId = agentId;

  document.getElementById('chatAgentName').textContent = agent.name;
  document.getElementById('chatAgentAvatar').textContent = agent.name.charAt(0).toUpperCase();
  document.getElementById('chatAgentSkills').textContent = `Skills: ${getSkillNames(agent.skillIds).join(' · ')}`;

  // Navigate first, show loading
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-chatwindow').classList.add('active');
  document.getElementById('nav-chat').classList.add('active');

  // Show loading messages indicator
  const container = document.getElementById('chatMessages');
  if (!agent.messagesLoaded) {
    container.innerHTML = `<div class="chat-empty" style="opacity:0.5"><p>Đang tải lịch sử chat...</p></div>`;
    try {
      const apiMessages = await apiGet(`/api/agents/${agentId}/messages`);
      agent.messages = apiMessages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
      agent.messagesLoaded = true;
    } catch (err) {
      console.warn('Load messages failed:', err);
      agent.messages = [];
      agent.messagesLoaded = true;
    }
  }

  renderChatMessages(agent);
  addToSharedMemory(agentId, agent.name, 'chat_opened', `Người dùng mở chat với "${agent.name}"`);
  document.getElementById('chatInput').focus();
}

function renderChatMessages(agent) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  if (agent.messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>Bắt đầu trò chuyện với <strong>${agent.name}</strong></p>
        <p style="font-size:12px;opacity:0.7">Skills: ${getSkillNames(agent.skillIds).join(' · ')}</p>
        <div style="margin-top:8px;padding:10px 16px;background:rgba(79,142,247,0.08);border:1px solid rgba(79,142,247,0.2);border-radius:8px;font-size:11px;color:#4F8EF7;max-width:380px;text-align:center">
          ✨ Powered by Gemini ${agent.model} · Lịch sử lưu vĩnh viễn bằng SQLite 💾
        </div>
      </div>`;
  } else {
    container.innerHTML = agent.messages.map(msg => renderMessageHTML(msg)).join('');
    container.scrollTop = container.scrollHeight;
  }
}

function renderMessageHTML(msg) {
  const time = (msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp))
    .toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const avatar = msg.role === 'user' ? 'U' : (currentAgent ? currentAgent.name.charAt(0).toUpperCase() : 'A');
  const contentHTML = msg.content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  return `
    <div class="chat-message ${msg.role}">
      <div class="msg-avatar">${avatar}</div>
      <div>
        <div class="msg-bubble">${contentHTML}</div>
        <div class="msg-meta">${time}${msg.usedSkill ? ` · <span style="color:var(--accent)">⚡ ${msg.usedSkill}</span>` : ''}</div>
      </div>
    </div>`;
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !currentAgent) return;

  input.value = '';
  input.style.height = 'auto';
  input.disabled = true;
  document.getElementById('chatSendBtn').disabled = true;

  const userMsg = { role: 'user', content: text, usedSkill: null, timestamp: new Date() };
  currentAgent.messages.push(userMsg);
  state.totalMessages++;
  document.getElementById('statMessages').textContent = state.totalMessages;

  addToSharedMemory(currentAgent.id, currentAgent.name, 'message_sent',
    `"${currentAgent.name}" nhận câu hỏi: ${text.substring(0, 100)}`);
  addLog('info', 'Chat', `[${currentAgent.name}] User: ${text.substring(0, 60)}`);
  renderChatMessages(currentAgent);

  // Typing indicator
  const container = document.getElementById('chatMessages');
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-message assistant';
  typingEl.id = 'typingIndicator';
  typingEl.innerHTML = `
    <div class="msg-avatar">${currentAgent.name.charAt(0).toUpperCase()}</div>
    <div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  try {
    await processAgentResponse(text, userMsg);
  } catch (err) {
    document.getElementById('typingIndicator')?.remove();
    const errMsg = { role: 'assistant', content: `❌ Lỗi: ${err.message}`, timestamp: new Date(), usedSkill: null };
    currentAgent.messages.push(errMsg);
    addLog('error', 'Gemini', err.message);
    renderChatMessages(currentAgent);
    showToast('Lỗi kết nối!', 'error');
  } finally {
    input.disabled = false;
    document.getElementById('chatSendBtn').disabled = false;
    input.focus();
  }
}

async function processAgentResponse(userInput, userMsg) {
  const agent = currentAgent;
  if (!agent) return;

  const sharedMemCtx = getSharedMemoryForAgent(agent.id);
  const systemPrompt = buildAgentSystemPrompt(agent, sharedMemCtx);

  const lowerInput = userInput.toLowerCase();
  const agentSkills = state.skills.filter(s => agent.skillIds.includes(s.id));
  let detectedSkillName = null;
  for (const skill of agentSkills) {
    if (skill.triggers && skill.triggers.some(t => lowerInput.includes(t.toLowerCase()))) {
      detectedSkillName = skill.name; break;
    }
  }

  // Lấy tên các agent khác để kiểm tra xem user có hỏi đích danh ai không
  const otherAgentNames = state.agents
    .filter(a => a.id !== agent.id)
    .map(a => a.name.toLowerCase());
  
  const isMemoryQuery = otherAgentNames.length > 0 && otherAgentNames.some(name => lowerInput.includes(name));

  const response = await callGeminiAPI(systemPrompt, userInput, agent.model);
  document.getElementById('typingIndicator')?.remove();

  const assistantMsg = { role: 'assistant', content: response, timestamp: new Date(), usedSkill: detectedSkillName };
  agent.messages.push(assistantMsg);
  state.totalMessages++;
  document.getElementById('statMessages').textContent = state.totalMessages;

  // Persist both messages to SQLite
  apiPost(`/api/agents/${agent.id}/messages`, {
    messages: [
      { role: 'user', content: userInput, usedSkill: null, timestamp: userMsg.timestamp.toISOString() },
      { role: 'assistant', content: response, usedSkill: detectedSkillName, timestamp: assistantMsg.timestamp.toISOString() },
    ]
  }).catch(err => console.warn('Save messages failed:', err));

  const isRefusal = response.includes('⛔') || response.includes('chỉ có thể');
  addToSharedMemory(agent.id, agent.name,
    isMemoryQuery ? 'memory_queried' : isRefusal ? 'request_refused' : 'skill_used',
    detectedSkillName
      ? `Dùng skill "${detectedSkillName}" cho: "${userInput.substring(0, 80)}"`
      : isRefusal ? `Từ chối: "${userInput.substring(0, 80)}"` : `Phản hồi: "${userInput.substring(0, 80)}"`
  );
  addLog(isRefusal ? 'warn' : 'success', 'Gemini',
    `[${agent.name}] ${detectedSkillName ? `⚡ ${detectedSkillName}` : isRefusal ? 'Refused' : 'OK'}`);

  renderChatMessages(currentAgent);
}

// ===== AGENT DETAIL =====
function openAgentDetail(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) return;
  document.getElementById('agentDetailTitle').textContent = `Agent: ${agent.name}`;
  document.getElementById('deleteAgentBtn').dataset.agentId = agentId;
  document.getElementById('chatWithAgentBtn').onclick = () => { closeModal('agentDetailModal'); openChatWithAgent(agentId); };

  const skillNames = getSkillNames(agent.skillIds);
  const catColors = { GENERAL: '#FF6B35', DEVELOPMENT: '#4F8EF7', RESEARCH: '#9B59B6', WRITING: '#2ECC71', BUSINESS: '#F39C12' };
  const catColor = catColors[agent.category?.toUpperCase()] || '#8b91a8';

  document.getElementById('agentDetailBody').innerHTML = `
    <div class="agent-detail-grid">
      <div class="detail-field"><div class="detail-field-label">TÊN AGENT</div><div class="detail-field-value">${agent.name}</div></div>
      <div class="detail-field"><div class="detail-field-label">MÔ HÌNH LLM</div><div class="detail-field-value" style="font-family:var(--font-mono);font-size:12px">${agent.model}</div></div>
      <div class="detail-field"><div class="detail-field-label">DANH MỤC</div><div class="detail-field-value" style="color:${catColor}">${agent.category}</div></div>
      <div class="detail-field"><div class="detail-field-label">TIN NHẮN</div><div class="detail-field-value">${agent.messages.length || agent.messageCount || 0}</div></div>
      <div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">MÔ TẢ</div><div class="detail-field-value" style="font-weight:400;color:var(--text-secondary)">${agent.desc}</div></div>
    </div>
    <div class="detail-skills-section">
      <div class="section-title">SKILLS (${agent.skillIds.length})</div>
      <div class="detail-skills-list">${skillNames.map(n => `<span class="detail-skill-tag">${n}</span>`).join('')}</div>
    </div>
    <div class="memory-section" style="margin-top:12px">
      <div class="section-title">NGÀY TẠO</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${agent.createdAt instanceof Date ? agent.createdAt.toLocaleString('vi-VN') : new Date(agent.createdAt).toLocaleString('vi-VN')}</div>
    </div>`;
  openModal('agentDetailModal');
}

async function deleteCurrentAgent() {
  const agentId = document.getElementById('deleteAgentBtn').dataset.agentId;
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) return;

  if (confirm(`Xóa agent "${agent.name}"? Toàn bộ lịch sử chat cũng sẽ bị xóa.`)) {
    try {
      await apiDelete(`/api/agents/${agentId}`);
      state.agents = state.agents.filter(a => a.id !== agentId);
      addLog('warn', 'Agents', `Đã xóa agent: "${agent.name}"`);
      renderAgentsList(); updateStatusBar(); updateStats();
      closeModal('agentDetailModal');
      showToast(`Agent "${agent.name}" đã bị xóa.`, 'info');
      if (state.currentChatAgentId === agentId) { state.currentChatAgentId = null; currentAgent = null; }
    } catch (err) {
      showToast(`Lỗi xóa agent: ${err.message}`, 'error');
    }
  }
}

function openChatWithCurrentAgent() {
  const agentId = document.getElementById('deleteAgentBtn').dataset.agentId;
  closeModal('agentDetailModal');
  if (agentId) openChatWithAgent(agentId);
}

// ===== OVERVIEW =====
function updateOverviewPage() {
  document.getElementById('statAgents').textContent = state.agents.length;
  document.getElementById('statSkills').textContent = state.skills.length;
  document.getElementById('statMessages').textContent = state.totalMessages;
  const overviewList = document.getElementById('overviewAgentList');
  if (state.agents.length === 0) {
    overviewList.innerHTML = '<div class="placeholder-content" style="height:100px"><p>Chưa có agent nào</p></div>'; return;
  }
  overviewList.innerHTML = state.agents.map(agent => `
    <div class="overview-agent-item">
      <div class="agent-avatar" style="width:32px;height:32px;font-size:13px;border-radius:8px">${agent.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1"><div style="font-weight:600">${agent.name}</div><div class="overview-agent-skills">${getSkillNames(agent.skillIds).join(' · ')}</div></div>
      <div style="font-size:11px;color:var(--text-muted)">${agent.messageCount || agent.messages?.length || 0} msgs</div>
      <span class="badge badge-${agent.status}">${agent.status.toUpperCase()}</span>
    </div>`).join('');
}

// ===== SESSIONS =====
function renderSessionsPage() {
  const list = document.getElementById('sessionsList');
  if (state.agents.length === 0) { list.innerHTML = '<div class="placeholder-content"><p>Chưa có phiên chat nào</p></div>'; return; }
  list.innerHTML = state.agents.map(agent => `
    <div class="session-item" onclick="openChatWithAgent('${agent.id}')">
      <div class="agent-avatar" style="width:40px;height:40px;font-size:16px">${agent.name.charAt(0)}</div>
      <div class="session-info"><div class="session-name">${agent.name}</div><div class="session-meta">${agent.model} · ${getSkillNames(agent.skillIds).join(', ')}</div></div>
      <div class="session-msgs">${agent.messageCount || agent.messages?.length || 0} tin nhắn</div>
      <span class="badge badge-${agent.status}">${agent.status.toUpperCase()}</span>
    </div>`).join('');
}

// ===== MEMORY PAGE =====
function renderMemoryPage() {
  const agentList = document.getElementById('memoryAgentList');
  const logsView = document.getElementById('memoryLogsView');
  const subtitle = document.getElementById('memorySubtitle');
  if (!agentList || !logsView || !subtitle) return;

  agentList.style.display = 'grid'; // .agents-list uses grid by default in CSS
  logsView.style.display = 'none';
  subtitle.style.display = 'block';

  if (state.agents.length === 0) {
    agentList.innerHTML = '<div class="placeholder-content" style="grid-column:1/-1"><p>Chưa có agent nào</p></div>';
    return;
  }

  agentList.innerHTML = state.agents.map(agent => {
    const entryCount = state.sharedMemory.filter(m => m.agentId === agent.id).length;
    return `
    <div class="agent-item" onclick="showAgentMemory('${agent.id}')">
      <div class="agent-avatar">${agent.name.charAt(0).toUpperCase()}</div>
      <div class="agent-info">
        <div class="agent-name">${agent.name}</div>
        <div class="agent-model" style="opacity:0.7">${entryCount} lượt hoạt động</div>
      </div>
      <button class="agent-settings-btn" style="pointer-events:none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>`;
  }).join('');
}

function showAgentMemory(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  const agentList = document.getElementById('memoryAgentList');
  const logsView = document.getElementById('memoryLogsView');
  const subtitle = document.getElementById('memorySubtitle');
  const container = document.getElementById('memoryContainer');
  const title = document.getElementById('memoryLogsTitle');
  if (!agent || !logsView) return;

  agentList.style.display = 'none';
  subtitle.style.display = 'none';
  logsView.style.display = 'flex';
  title.textContent = `Lịch sử trí nhớ: ${agent.name}`;

  const mems = state.sharedMemory.filter(m => m.agentId === agentId);

  if (mems.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px">Agent này chưa có hoạt động nào trong Shared Memory.</div>';
    return;
  }
  
  container.innerHTML = [...mems].reverse().map(m => {
    const d = new Date(m.timestamp);
    const time = `${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${d.toLocaleDateString('vi-VN')}`;
    let typeColor = m.type === 'agent_created' ? 'var(--accent)' :
                    m.type === 'skill_used' ? '#4F8EF7' : 
                    m.type === 'request_refused' ? '#F39C12' : '#8b91a8';
    return `
      <div class="log-entry" style="margin-bottom:8px;padding:12px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${time}</span>
          <span style="font-weight:600;font-size:13px">${m.agentName}</span>
          <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:${typeColor}">${m.type.toUpperCase()}</span>
        </div>
        <div style="font-size:13px;color:var(--text-primary)">${m.content}</div>
      </div>
    `;
  }).join('');
}

// ===== LOGS =====
function addLog(level, source, msg) { state.logs.push({ level, source, msg, time: new Date() }); }
function renderLogsPage() {
  const container = document.getElementById('logsContainer');
  if (state.logs.length === 0) { container.innerHTML = '<div style="color:var(--text-muted);padding:8px">Chưa có logs.</div>'; return; }
  container.innerHTML = [...state.logs].reverse().map(log => {
    const time = log.time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="log-entry"><span class="log-time">${time}</span><span class="log-level ${log.level}">${log.level.toUpperCase()}</span><span style="color:var(--accent);min-width:70px">[${log.source}]</span><span class="log-msg">${log.msg}</span></div>`;
  }).join('');
}

// ===== STATUS & STATS =====
function updateStatusBar() {
  const running = state.agents.filter(a => a.status === 'running').length;
  document.getElementById('agentStatusText').textContent = `${running} agent${running !== 1 ? '(s)' : ''} running`;
}
function updateStats() {
  document.getElementById('statAgents').textContent = state.agents.length;
  document.getElementById('statSkills').textContent = state.skills.length;
  document.getElementById('statMessages').textContent = state.totalMessages;
}
function startUptimeTimer() {
  setInterval(() => {
    const diff = Date.now() - state.startTime;
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    const el = document.getElementById('statUptime');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
});

// ===== TOAST =====
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 4000);
}

// ===== KEYBOARD =====
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openNewAgentModal(); }
  if (e.key === 'Escape') { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }
});
