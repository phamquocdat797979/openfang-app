// ===== STATE =====
const state = {
  agents: [],
  skills: [],
  sharedMemory: [],
  logs: [],
  currentChatAgentId: null,
  totalMessages: 0,
  startTime: Date.now(),
};

// ===== BUILT-IN SKILLS =====
const BUILTIN_SKILLS = [
  {
    id: 'skill_double',
    name: 'Nhân Đôi Số Nguyên',
    category: 'MATH',
    desc: 'Nhân đôi một số nguyên bất kỳ. Ví dụ: nhận vào 5 và trả về 10.',
    example: '"nhân đôi 7" → "Kết quả: 14"',
    icon: '✖️',
    builtin: true,
    systemInstruction: `Skill của bạn: Nhân Đôi Số Nguyên.
Khi người dùng yêu cầu nhân đôi một số, hãy tìm số nguyên trong câu, nhân đôi nó và trả lời.
Trả lời format: "🔢 Kết quả nhân đôi: [số gốc] × 2 = [kết quả]"
Ví dụ: "nhân đôi 42" → "🔢 Kết quả nhân đôi: 42 × 2 = 84"`,
    triggers: ['nhân đôi', 'gấp đôi', 'double', 'x2', 'nhân 2', 'times 2'],
  },
  {
    id: 'skill_uppercase',
    name: 'Chuyển Đổi Chữ In Hoa',
    category: 'TEXT',
    desc: 'Chuyển đổi chữ thường thành chữ in hoa toàn bộ.',
    example: '"chuyển in hoa: hello world" → "HELLO WORLD"',
    icon: '🔤',
    builtin: true,
    systemInstruction: `Skill của bạn: Chuyển Đổi Chữ In Hoa.
Khi người dùng yêu cầu chuyển văn bản sang chữ in hoa, hãy thực hiện việc đó.
Trích xuất phần văn bản cần chuyển, chuyển toàn bộ sang IN HOA và trả lời.
Trả lời format: "🔤 Kết quả chuyển đổi:\n[VĂN BẢN IN HOA]"`,
    triggers: ['chuyển in hoa', 'uppercase', 'in hoa', 'viết hoa', 'chữ hoa', 'to uppercase'],
  },
  {
    id: 'skill_summarize',
    name: 'Tóm Tắt Văn Bản',
    category: 'AI',
    desc: 'Tóm tắt một đoạn văn bản dài thành bản tóm tắt ngắn gọn, súc tích.',
    example: '"tóm tắt: [đoạn văn dài]" → "[bản tóm tắt]"',
    icon: '📝',
    builtin: true,
    systemInstruction: `Skill của bạn: Tóm Tắt Văn Bản.
Khi người dùng cung cấp một đoạn văn bản và yêu cầu tóm tắt, hãy tạo ra bản tóm tắt ngắn gọn, súc tích, nắm bắt đúng ý chính.
Trả lời format:
"📝 **Tóm tắt:**\n[bản tóm tắt 2-4 câu]\n\n**Ý chính:**\n• [ý 1]\n• [ý 2]\n• [ý 3]"`,
    triggers: ['tóm tắt', 'summarize', 'tóm lược', 'tổng hợp', 'tóm gọn', 'summary'],
  },
];

// ===== GEMINI API — gọi qua proxy server (API key an toàn trên server) =====
async function callGeminiAPI(systemPrompt, userMessage, model) {
  const apiModel = model || OPENFANG_CONFIG.GEMINI_MODEL;

  const response = await fetch(OPENFANG_CONFIG.API_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: apiModel,
      systemInstruction: systemPrompt,
      userMessage: userMessage,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
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

// Build system prompt for an agent based on its skills + shared memory context
function buildAgentSystemPrompt(agent, sharedMemoryContext) {
  const agentSkills = state.skills.filter(s => agent.skillIds.includes(s.id));

  const skillsText = agentSkills.map((s, i) =>
    `${i + 1}. **${s.name}** (${s.category}): ${s.desc}\n   ${s.systemInstruction || ''}`
  ).join('\n\n');

  const memoryText = sharedMemoryContext.length > 0
    ? `\n\n=== SHARED MEMORY (Hoạt động các agent khác) ===\n` +
      sharedMemoryContext.slice(-10).map(m => {
        const time = m.timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        return `[${time}] ${m.agentName}: ${m.content}`;
      }).join('\n')
    : '';

  return `Bạn là ${agent.name}, một AI agent chuyên biệt trong hệ thống OpenFang.

=== SKILLS CỦA BẠN (CHỈ được thực hiện các tác vụ này) ===
${skillsText}

=== QUY TẮC BẮT BUỘC ===
1. Bạn CHỈ được thực hiện các tác vụ trong danh sách skills ở trên.
2. Nếu yêu cầu của người dùng KHÔNG liên quan đến bất kỳ skill nào của bạn, hãy từ chối lịch sự và liệt kê các skills bạn có.
3. Khi từ chối, dùng format: "⛔ Xin lỗi, tôi là **${agent.name}** và tôi chỉ có thể thực hiện: [danh sách skills]. Bạn hãy thử lại với một trong những tác vụ trên nhé! 😊"
4. Trả lời bằng tiếng Việt trừ khi người dùng hỏi bằng tiếng Anh.
5. Nếu người dùng hỏi về hoạt động của agent khác hoặc shared memory, hãy báo cáo thông tin từ shared memory bên dưới.
6. KHÔNG được trả lời các câu hỏi chung chung, thời tiết, kiến thức tổng hợp, hay bất kỳ thứ gì ngoài skills của bạn.${memoryText}`;
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  state.skills = [...BUILTIN_SKILLS];
  renderSkillsPage();
  renderSkillsSelector();
  updateStatusBar();
  updateStats();
  startUptimeTimer();
  addLog('info', 'System', 'OpenFang Agent OS khởi động thành công');
  addLog('success', 'System', `Tải ${state.skills.length} skills thành công`);
  addLog('success', 'Gemini', `Proxy server kết nối (model: ${OPENFANG_CONFIG.GEMINI_MODEL})`);
  navigateTo('chat');
  showGeminiBadge();

  // Verify server health
  fetch('/api/health').then(r => r.json()).then(d => {
    addLog('success', 'Server', `Health check OK — ${d.model}`);
  }).catch(() => addLog('warn', 'Server', 'Health check thất bại'));
});

function showGeminiBadge() {
  const statusBar = document.querySelector('.agent-status-bar');
  if (!statusBar) return;
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
  if (page === 'logs') renderLogsPage();
  if (page === 'skills') renderSkillsPage();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ===== SKILLS PAGE =====
function renderSkillsPage() {
  const grid = document.getElementById('skillsGrid');
  if (!grid) return;
  grid.innerHTML = state.skills.map(skill => `
    <div class="skill-card" id="skillcard-${skill.id}">
      <div class="skill-card-header">
        <div class="skill-icon ${skill.category.toLowerCase()}">${skill.icon || '⚡'}</div>
        <span class="skill-badge">${skill.category}</span>
      </div>
      <div class="skill-name">${skill.name}</div>
      <div class="skill-desc">${skill.desc}</div>
      ${skill.example ? `<div class="skill-example">${skill.example}</div>` : ''}
    </div>
  `).join('');
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
  openModal('newSkillModal');
}

function createSkill() {
  const name = document.getElementById('skillNameInput').value.trim();
  const desc = document.getElementById('skillDescInput').value.trim();
  const category = document.getElementById('skillCategoryInput').value;
  const example = document.getElementById('skillExampleInput').value.trim();
  if (!name) { showToast('Vui lòng nhập tên skill!', 'error'); return; }
  if (!desc) { showToast('Vui lòng nhập mô tả skill!', 'error'); return; }
  const icons = { MATH: '🔢', TEXT: '📄', AI: '🤖', UTILITY: '⚙️', CUSTOM: '✨' };
  state.skills.push({
    id: `skill_${Date.now()}`, name, category, desc,
    example: example || '', icon: icons[category] || '⚡',
    builtin: false,
    systemInstruction: `Skill của bạn: ${name}. ${desc}`,
    triggers: [],
  });
  renderSkillsPage(); renderSkillsSelector();
  closeModal('newSkillModal');
  showToast(`Skill "${name}" đã được thêm!`, 'success');
  addLog('success', 'Skills', `Skill mới: "${name}"`);
}

// ===== NEW AGENT MODAL =====
function openNewAgentModal() {
  document.getElementById('agentNameInput').value = '';
  document.getElementById('agentDescInput').value = '';
  state.skills.forEach(s => { const el = document.getElementById(`skillsel-${s.id}`); if (el) el.classList.remove('selected'); });
  document.getElementById('skillsError').style.display = 'none';
  renderSkillsSelector();
  openModal('newAgentModal');
}

function openNewAgentModalWithTemplate(name, category, desc) {
  document.getElementById('agentNameInput').value = name;
  document.getElementById('agentDescInput').value = desc;
  document.getElementById('agentCategorySelect').value = category;
  state.skills.forEach(s => { const el = document.getElementById(`skillsel-${s.id}`); if (el) el.classList.remove('selected'); });
  document.getElementById('skillsError').style.display = 'none';
  renderSkillsSelector();
  openModal('newAgentModal');
}

function createAgent() {
  const name = document.getElementById('agentNameInput').value.trim();
  const model = document.getElementById('agentModelSelect').value;
  const category = document.getElementById('agentCategorySelect').value;
  const desc = document.getElementById('agentDescInput').value.trim();
  const selectedSkillIds = getSelectedSkillIds();
  if (!name) { showToast('Vui lòng nhập tên agent!', 'error'); return; }
  if (selectedSkillIds.length === 0) {
    document.getElementById('skillsError').style.display = 'block';
    showToast('Bắt buộc phải chọn ít nhất 1 skill!', 'error'); return;
  }
  const agent = {
    id: `agent_${Date.now()}`, name, model, category,
    desc: desc || `Agent ${name} với ${selectedSkillIds.length} skill(s)`,
    skillIds: selectedSkillIds, status: 'running',
    createdAt: new Date(), messages: [],
  };
  state.agents.push(agent);
  addToSharedMemory(agent.id, agent.name, 'agent_created',
    `Agent "${agent.name}" vừa được tạo với skills: ${getSkillNames(selectedSkillIds).join(', ')}`);
  renderAgentsList(); updateStatusBar(); updateStats();
  closeModal('newAgentModal');
  showToast(`Agent "${name}" đã được tạo!`, 'success');
  addLog('success', 'Agents', `Agent mới: "${name}" (${model})`);
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
function addToSharedMemory(agentId, agentName, type, content) {
  state.sharedMemory.push({ agentId, agentName, type, content, timestamp: new Date() });
}
function getSharedMemoryForAgent(agentId) {
  return state.sharedMemory.filter(m => m.agentId !== agentId);
}

// ===== CHAT =====
let currentAgent = null;

function openChatWithAgent(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) return;
  currentAgent = agent;
  state.currentChatAgentId = agentId;
  document.getElementById('chatAgentName').textContent = agent.name;
  document.getElementById('chatAgentAvatar').textContent = agent.name.charAt(0).toUpperCase();
  document.getElementById('chatAgentSkills').textContent = `Skills: ${getSkillNames(agent.skillIds).join(' · ')}`;
  renderChatMessages(agent);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-chatwindow').classList.add('active');
  document.getElementById('nav-chat').classList.add('active');
  addToSharedMemory(agentId, agent.name, 'chat_opened', `Người dùng bắt đầu chat với agent "${agent.name}"`);
  document.getElementById('chatInput').focus();
}

function openChatWithCurrentAgent() {
  const agentId = document.getElementById('deleteAgentBtn').dataset.agentId;
  closeModal('agentDetailModal');
  if (agentId) openChatWithAgent(agentId);
}

function renderChatMessages(agent) {
  const container = document.getElementById('chatMessages');
  if (agent.messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>Bắt đầu trò chuyện với <strong>${agent.name}</strong></p>
        <p style="font-size:12px;opacity:0.7">Skills: ${getSkillNames(agent.skillIds).join(' · ')}</p>
        <div style="margin-top:8px;padding:10px 16px;background:rgba(79,142,247,0.08);border:1px solid rgba(79,142,247,0.2);border-radius:8px;font-size:11px;color:#4F8EF7;max-width:360px;text-align:center">
          ✨ Powered by Gemini ${agent.model} · API key secured on server
        </div>
      </div>`;
  } else {
    container.innerHTML = agent.messages.map(msg => renderMessageHTML(msg)).join('');
    container.scrollTop = container.scrollHeight;
  }
}

function renderMessageHTML(msg) {
  const time = msg.timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
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

  const userMsg = { role: 'user', content: text, timestamp: new Date() };
  currentAgent.messages.push(userMsg);
  state.totalMessages++;
  document.getElementById('statMessages').textContent = state.totalMessages;

  addToSharedMemory(currentAgent.id, currentAgent.name, 'message_sent',
    `Người dùng hỏi "${currentAgent.name}": ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
  addLog('info', 'Chat', `[${currentAgent.name}] User: ${text.substring(0, 60)}`);
  renderChatMessages(currentAgent);

  // Show typing indicator
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
    await processAgentResponse(text);
  } catch (err) {
    const t = document.getElementById('typingIndicator');
    if (t) t.remove();
    currentAgent.messages.push({ role: 'assistant', content: `❌ Lỗi: ${err.message}`, timestamp: new Date() });
    addLog('error', 'Gemini', err.message);
    renderChatMessages(currentAgent);
    showToast('Lỗi kết nối server!', 'error');
  } finally {
    input.disabled = false;
    document.getElementById('chatSendBtn').disabled = false;
    input.focus();
  }
}

async function processAgentResponse(userInput) {
  const agent = currentAgent;
  if (!agent) return;
  const typingEl = document.getElementById('typingIndicator');
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
  const isMemoryQuery = ['agent khác','agent kia','agent 1','agent 2','shared memory',
    'làm gì','đã làm','hoạt động','lịch sử','memory','other agent','báo cáo']
    .some(kw => lowerInput.includes(kw));

  const response = await callGeminiAPI(systemPrompt, userInput, agent.model);
  if (typingEl) typingEl.remove();

  const assistantMsg = { role: 'assistant', content: response, timestamp: new Date(), usedSkill: detectedSkillName };
  agent.messages.push(assistantMsg);
  state.totalMessages++;
  document.getElementById('statMessages').textContent = state.totalMessages;

  const isRefusal = response.includes('⛔') || response.includes('chỉ có thể');
  const memType = isMemoryQuery ? 'memory_queried' : isRefusal ? 'request_refused' : 'skill_used';
  addToSharedMemory(agent.id, agent.name, memType,
    detectedSkillName ? `Dùng skill "${detectedSkillName}" trả lời: "${userInput.substring(0, 80)}"`
    : isMemoryQuery ? `Truy vấn shared memory`
    : isRefusal ? `Từ chối: "${userInput.substring(0, 80)}"`
    : `Phản hồi: "${userInput.substring(0, 80)}"`);
  addLog(isRefusal ? 'warn' : 'success', 'Gemini', `[${agent.name}] ${detectedSkillName ? `Skill: ${detectedSkillName}` : isRefusal ? 'Refused' : 'OK'}`);
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
  const otherAgentMemory = getSharedMemoryForAgent(agentId).slice(-8);
  const catColors = { general:'#FF6B35', development:'#4F8EF7', research:'#9B59B6', writing:'#2ECC71', business:'#F39C12' };
  const catColor = catColors[agent.category.toLowerCase()] || '#8b91a8';
  document.getElementById('agentDetailBody').innerHTML = `
    <div class="agent-detail-grid">
      <div class="detail-field"><div class="detail-field-label">TÊN AGENT</div><div class="detail-field-value">${agent.name}</div></div>
      <div class="detail-field"><div class="detail-field-label">MÔ HÌNH LLM</div><div class="detail-field-value" style="font-family:var(--font-mono);font-size:12px">${agent.model}</div></div>
      <div class="detail-field"><div class="detail-field-label">DANH MỤC</div><div class="detail-field-value" style="color:${catColor}">${agent.category}</div></div>
      <div class="detail-field"><div class="detail-field-label">TRẠNG THÁI</div><div class="detail-field-value" style="color:var(--green)">● ${agent.status.toUpperCase()}</div></div>
      <div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">MÔ TẢ</div><div class="detail-field-value" style="font-weight:400;color:var(--text-secondary)">${agent.desc}</div></div>
    </div>
    <div class="detail-skills-section">
      <div class="section-title">SKILLS ĐÃ ĐĂNG KÝ (${agent.skillIds.length})</div>
      <div class="detail-skills-list">${skillNames.map(n => `<span class="detail-skill-tag">${n}</span>`).join('')}</div>
    </div>
    <div class="memory-section">
      <div class="section-title">SHARED MEMORY — HOẠT ĐỘNG AGENT KHÁC</div>
      ${otherAgentMemory.length === 0
        ? '<div class="memory-entry" style="color:var(--text-muted)">Chưa có dữ liệu từ agent khác.</div>'
        : `<div class="memory-list">${otherAgentMemory.map(m => {
            const time = m.timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            return `<div class="memory-entry"><strong>[${time}] ${m.agentName}:</strong> ${m.content}</div>`;
          }).join('')}</div>`}
    </div>
    <div class="memory-section" style="margin-top:12px">
      <div class="section-title">THỐNG KÊ</div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <div class="detail-field" style="flex:1"><div class="detail-field-label">TIN NHẮN</div><div class="detail-field-value">${agent.messages.length}</div></div>
        <div class="detail-field" style="flex:1"><div class="detail-field-label">NGÀY TẠO</div><div class="detail-field-value" style="font-size:11px">${agent.createdAt.toLocaleString('vi-VN')}</div></div>
      </div>
    </div>`;
  openModal('agentDetailModal');
}

function deleteCurrentAgent() {
  const agentId = document.getElementById('deleteAgentBtn').dataset.agentId;
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) return;
  if (confirm(`Bạn có chắc muốn xóa agent "${agent.name}"?`)) {
    state.agents = state.agents.filter(a => a.id !== agentId);
    addLog('warn', 'Agents', `Agent xóa: "${agent.name}"`);
    addToSharedMemory('system', 'System', 'agent_deleted', `Agent "${agent.name}" đã bị xóa`);
    renderAgentsList(); updateStatusBar(); updateStats();
    closeModal('agentDetailModal');
    showToast(`Agent "${agent.name}" đã bị xóa.`, 'info');
    if (state.currentChatAgentId === agentId) { state.currentChatAgentId = null; currentAgent = null; }
  }
}

// ===== OVERVIEW =====
function updateOverviewPage() {
  document.getElementById('statAgents').textContent = state.agents.length;
  document.getElementById('statSkills').textContent = state.skills.length;
  document.getElementById('statMessages').textContent = state.totalMessages;
  const overviewList = document.getElementById('overviewAgentList');
  if (state.agents.length === 0) { overviewList.innerHTML = '<div class="placeholder-content" style="height:100px"><p>Chưa có agent nào</p></div>'; return; }
  overviewList.innerHTML = state.agents.map(agent => `
    <div class="overview-agent-item">
      <div class="agent-avatar" style="width:32px;height:32px;font-size:13px;border-radius:8px">${agent.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1"><div style="font-weight:600">${agent.name}</div><div class="overview-agent-skills">${getSkillNames(agent.skillIds).join(' · ')}</div></div>
      <div style="font-size:11px;color:var(--text-muted)">${agent.messages.length} msgs</div>
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
      <div class="session-msgs">${agent.messages.length} tin nhắn</div>
      <span class="badge badge-${agent.status}">${agent.status.toUpperCase()}</span>
    </div>`).join('');
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
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
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

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openNewAgentModal(); }
  if (e.key === 'Escape') { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }
});
