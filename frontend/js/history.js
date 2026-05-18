// js/history.js — Chat history sidebar (session list)
import Config from './config.js';
import { getUser } from './auth.js';

// ── Fetch sessions from backend ───────────────────────────────
export async function fetchSessions() {
  const user = getUser();
  if (!user) return [];

  try {
    const res = await fetch(`${Config.API_BASE_URL}/sessions`, {
      headers: { 'x-user-id': user.id }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch (e) {
    console.warn('[History] Failed to fetch sessions:', e.message);
    return [];
  }
}

export async function fetchSession(sessionId) {
  const user = getUser();
  if (!user) return null;
  try {
    const res = await fetch(`${Config.API_BASE_URL}/sessions/${sessionId}`, {
      headers: { 'x-user-id': user.id }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[History] Failed to fetch session:', e.message);
    return null;
  }
}

// ── Render sidebar ────────────────────────────────────────────
export async function renderSidebar(onSelectSession, onNewChat) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const user = getUser();
  if (!user) return;

  // ── Sidebar click-to-open (not hover) ──────────────────────
  // Remove hover; open on click of collapsed sliver, close on outside click
  if (!sidebar._clickBound) {
    sidebar._clickBound = true;

    sidebar.addEventListener('click', (e) => {
      if (!sidebar.classList.contains('sidebar--open')) {
        sidebar.classList.add('sidebar--open');
        e.stopPropagation();
      }
    });

    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('sidebar--open') && !sidebar.contains(e.target)) {
        sidebar.classList.remove('sidebar--open');
      }
    });
  }

  // Render skeleton first
  sidebar.innerHTML = `
    <div class="sidebar-top">
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">
          <img src="./BUSimInt_Logo.png" alt="BUSimInt">
        </div>
        <span class="sidebar-brand-name">BUSimInt</span>
      </div>

      <button class="sidebar-new-btn" id="sidebar-new-btn" title="New Interview">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>New Interview</span>
      </button>
    </div>

    <div class="sidebar-section-label">History</div>

    <div class="sidebar-sessions" id="sidebar-sessions">
      <div class="sidebar-loading">
        <div class="sidebar-skeleton"></div>
        <div class="sidebar-skeleton"></div>
        <div class="sidebar-skeleton"></div>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="sidebar-user">
        <img class="sidebar-avatar" src="${user.avatarUrl || ''}" alt="${user.name}" onerror="this.style.display='none'">
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">${user.name || user.email}</span>
          <span class="sidebar-user-email">${user.email}</span>
        </div>
        <button class="sidebar-logout-btn" id="sidebar-logout-btn" title="Sign out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  document.getElementById('sidebar-new-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.remove('sidebar--open');
    onNewChat();
  });

  document.getElementById('sidebar-logout-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    import('./auth.js').then(({ logout }) => {
      logout();
      window.location.reload();
    });
  });

  // Load sessions
  const sessions = await fetchSessions();
  renderSessionList(sessions, onSelectSession);
}

function renderSessionList(sessions, onSelect) {
  const container = document.getElementById('sidebar-sessions');
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = `<p class="sidebar-empty">No interviews yet.<br>Start one to see your history here.</p>`;
    return;
  }

  // Group by date
  const groups = groupByDate(sessions);

  container.innerHTML = Object.entries(groups).map(([label, items]) => `
    <div class="sidebar-group">
      <div class="sidebar-group-label">${label}</div>
      ${items.map(s => renderSessionItem(s)).join('')}
    </div>
  `).join('');

  // Bind clicks and menus
  container.querySelectorAll('.sidebar-session-item').forEach(el => {
    // Click on item (not on the 3-dot btn) → load session
    el.addEventListener('click', (e) => {
      if (e.target.closest('.session-menu-btn') || e.target.closest('.session-dropdown')) return;
      onSelect(el.dataset.id);
    });

    // 3-dot menu toggle
    const menuBtn = el.querySelector('.session-menu-btn');
    const dropdown = el.querySelector('.session-dropdown');
    if (menuBtn && dropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other open dropdowns
        document.querySelectorAll('.session-dropdown.open').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
      });
    }

    // Delete item
    const deleteBtn = el.querySelector('.session-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown?.classList.remove('open');
        if (!confirm('Delete this interview session?')) return;
        const group = el.closest('.sidebar-group'); // capture BEFORE remove
        await deleteSession(el.dataset.id);
        el.remove();
        if (group && group.querySelectorAll('.sidebar-session-item').length === 0) {
          group.remove();
        }
      });
    }
  });

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.session-dropdown.open').forEach(d => d.classList.remove('open'));
  }, { once: false });
}

function renderSessionItem(session) {
  const score = session.analysis_results?.[0]?.overall_score;
  const scoreBadge = score != null
    ? `<span class="session-score ${scoreClass(score)}">${score}</span>`
    : session.status === 'active'
    ? `<span class="session-status-dot"></span>`
    : '';

  return `
    <div class="sidebar-session-item" data-id="${session.id}">
      <div class="session-info">
        <span class="session-title">${escHTML(session.title || session.interview_type)}</span>
      </div>
      ${scoreBadge}
      <button class="session-menu-btn" title="Options">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
        <div class="session-dropdown">
          <div class="session-dropdown-item session-delete-btn danger">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Delete
          </div>
        </div>
      </button>
    </div>
  `;
}

// ── Delete session ────────────────────────────────────────────
async function deleteSession(sessionId) {
  const user = getUser();
  if (!user) return;
  try {
    await fetch(`${Config.API_BASE_URL}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': user.id }
    });
  } catch (e) {
    console.warn('[History] Delete failed:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function groupByDate(sessions) {
  const now = new Date();
  const groups = { Today: [], Yesterday: [], 'This Week': [], Older: [] };

  sessions.forEach(s => {
    const d = new Date(s.created_at);
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0)      groups['Today'].push(s);
    else if (diffDays === 1) groups['Yesterday'].push(s);
    else if (diffDays <= 7)  groups['This Week'].push(s);
    else                     groups['Older'].push(s);
  });

  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0));
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function scoreClass(s) {
  return s >= 75 ? 'score-good' : s >= 50 ? 'score-ok' : 'score-poor';
}

function getTypeIcon(type = '') {
  const map = {
    'Software Engineering': '💻', 'IT Support': '🛠️', 'Customer Service': '🎧',
    'Nursing': '🏥', 'Business Management': '📊', 'Marketing': '📣',
    'Teaching': '📚', 'Finance': '💰', 'General': '👔',
  };
  return map[type] || '💼';
}

function escHTML(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function highlightActiveSession(sessionId) {
  document.querySelectorAll('.sidebar-session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === sessionId);
  });
}
