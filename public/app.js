// Константы
const API_URL = window.location.origin;
let currentUser = null;

// Глобальные переменные для хранения текущих фильтров
let currentFilters = {
    status: 'all',
    priority: 'all',
    branch: '',
    search: ''
};

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    if (token && userStr) {
        try {
            currentUser = JSON.parse(userStr);
            
            const path = window.location.pathname;
            
            if (path.includes('user.html') && !currentUser.isAdmin) {
                loadUserPage();
            } else if (path.includes('admin.html') && currentUser.isAdmin) {
                loadAdminPage();
            } else if (path === '/' || path === '/index.html') {
                // на странице входа
            } else {
                if (currentUser.isAdmin) {
                    window.location.href = '/admin.html';
                } else {
                    window.location.href = '/user.html';
                }
            }
        } catch(e) {
            console.error(e);
        }
    } else if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
        window.location.href = '/index.html';
    }
});

// Обработчик формы входа
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const login = document.getElementById('login').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                if (data.user.isAdmin) {
                    window.location.href = '/admin.html';
                } else {
                    window.location.href = '/user.html';
                }
            } else {
                document.getElementById('errorMessage').textContent = data.error || 'Ошибка входа';
            }
        } catch (err) {
            document.getElementById('errorMessage').textContent = 'Ошибка соединения с сервером';
        }
    });
}

// Кнопка выхода
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/index.html';
    });
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

function getCategoryText(category) {
    const map = {
        'computer': '🖥️ Компьютер',
        'printer': '🖨️ Принтер',
        'network': '🌐 Сеть',
        'phone': '📞 Телефония',
        'electric': '🔌 Электрика',
        'furniture': '🪑 Мебель',
        'other': '❓ Другое'
    };
    return map[category] || category;
}

function getPriorityText(priority) {
    const map = {
        'high': '🔴 Высокий',
        'medium': '🟡 Средний',
        'low': '🟢 Низкий'
    };
    return map[priority] || priority;
}

function getStatusText(status) {
    const map = {
        'new': '🟡 Новая',
        'in_progress': '🔵 В работе',
        'completed': '🟢 Выполнена',
        'cancelled': '🔴 Отменена'
    };
    return map[status] || status;
}

function showToast(message) {
    const oldToast = document.querySelector('.toast-message');
    if (oldToast) oldToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 2000);
}

// Копирование номера заявки
window.copyTicketId = async function(ticketId) {
    try {
        await navigator.clipboard.writeText(ticketId.toString());
        
        const btn = document.querySelector(`.copy-btn[data-id="${ticketId}"]`);
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 1500);
        }
        
        showToast('Номер заявки скопирован');
    } catch (err) {
        showToast('Не удалось скопировать');
    }
};

// ============ СТРАНИЦА ЗАВЕДУЮЩЕЙ ============

async function loadUserPage() {
    document.getElementById('userInfo').innerHTML = `<strong>${currentUser.name}</strong> — система заявок`;
    
    // Настройка вкладок
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(tabId + 'Tab').classList.add('active');
            
            if (tabId === 'list') {
                loadTickets();
            }
        });
    });
    
    await loadTickets();
    
    const ticketForm = document.getElementById('ticketForm');
    if (ticketForm) {
        ticketForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const problem = document.getElementById('problem').value;
            const category = document.getElementById('category').value;
            const priority = document.getElementById('priority').value;
            const photoFile = document.getElementById('photo').files[0];
            
            if (!problem.trim()) {
                document.getElementById('errorMessage').textContent = 'Опишите проблему';
                return;
            }
            
            const formData = new FormData();
            formData.append('problem', problem);
            formData.append('category', category);
            formData.append('priority', priority);
            if (photoFile) formData.append('photo', photoFile);
            
            const submitBtn = ticketForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Отправка...';
            
            try {
                const response = await fetch(`${API_URL}/api/tickets`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });
                
                if (response.ok) {
                    document.getElementById('successMessage').textContent = '✅ Заявка отправлена!';
                    document.getElementById('problem').value = '';
                    document.getElementById('photo').value = '';
                    document.getElementById('category').value = 'computer';
                    document.getElementById('priority').value = 'medium';
                    await loadTickets();
                    
                    document.querySelector('.tab-btn[data-tab="list"]').click();
                    
                    setTimeout(() => {
                        document.getElementById('successMessage').textContent = '';
                    }, 3000);
                } else {
                    const err = await response.json();
                    document.getElementById('errorMessage').textContent = err.error || 'Ошибка';
                }
            } catch (err) {
                document.getElementById('errorMessage').textContent = 'Ошибка соединения';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = '📤 Отправить заявку';
            }
        });
    }
}

async function loadTickets() {
    const container = document.getElementById('ticketsList');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center;">Загрузка...</div>';
    
    try {
        const response = await fetch(`${API_URL}/api/tickets`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const tickets = await response.json();
        
        if (tickets.length === 0) {
            container.innerHTML = '<p style="text-align: center;">Пока нет заявок</p>';
            return;
        }
        
        let html = '';
        for (const ticket of tickets) {
            const priorityClass = ticket.priority === 'high' ? 'priority-high' : 
                                 (ticket.priority === 'medium' ? 'priority-medium' : 'priority-low');
            
            html += `
                <div class="ticket-item ${priorityClass}" data-id="${ticket.id}">
                    <div>
                        <strong>№${ticket.id}</strong>
                        <button class="copy-btn" data-id="${ticket.id}" onclick="copyTicketId(${ticket.id})" style="background: none; border: none; cursor: pointer; font-size: 14px; margin-left: 8px;">📋</button>
                        — ${new Date(ticket.created_at).toLocaleString('ru-RU')}
                    </div>
                    <div><strong>Статус:</strong> <span class="ticket-status status-${ticket.status}">${getStatusText(ticket.status)}</span></div>
                    <div><strong>Категория:</strong> ${getCategoryText(ticket.category)}</div>
                    <div><strong>Срочность:</strong> ${getPriorityText(ticket.priority)}</div>
                    <div><strong>Проблема:</strong> ${ticket.problem}</div>
                    ${ticket.photo_path ? `<img src="${ticket.photo_path}" class="ticket-photo" onclick="window.open(this.src)">` : ''}
                    
                    <!-- БЛОК КОММЕНТАРИЕВ ДЛЯ ЗАВЕДУЮЩЕЙ -->
                    <div class="comments-section" id="user-comments-${ticket.id}" style="margin-top: 12px; border-top: 1px solid #eee; padding-top: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleUserComments(${ticket.id})">
                            <strong>💬 Комментарии</strong>
                            <span id="comments-toggle-icon-${ticket.id}">▼</span>
                        </div>
                        <div id="user-comments-list-${ticket.id}" style="display: none; margin-top: 8px;"></div>
                        <div class="comment-form" id="user-comment-form-${ticket.id}" style="display: none; margin-top: 8px;">
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="user-comment-input-${ticket.id}" placeholder="Написать комментарий..." style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px;">
                                <button onclick="submitUserComment(${ticket.id})" style="background: #007aff; color: white; border: none; padding: 8px 16px; border-radius: 8px;">Отправить</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
        
    } catch (err) {
        container.innerHTML = '<p style="text-align: center;">Ошибка загрузки заявок</p>';
    }
}

// ============ АДМИН-ПАНЕЛЬ ============

async function loadAdminPage() {
    await loadStats();
    await loadBranches();
    await loadAdminTickets();
    
    document.getElementById('applyFilters').addEventListener('click', applyFilters);
    document.getElementById('resetFilters').addEventListener('click', resetFilters);
    
    const exportBtn = document.getElementById('exportExcel');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    }
}

async function loadStats() {
    const container = document.getElementById('stats');
    if (!container) return;
    
    try {
        const response = await fetch(`${API_URL}/api/stats`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const stats = await response.json();
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${stats.total || 0}</div><div class="stat-label">Всего заявок</div></div>
                <div class="stat-card"><div class="stat-value" style="color: #ffd700;">${stats.new_count || 0}</div><div class="stat-label">🟡 Новые</div></div>
                <div class="stat-card"><div class="stat-value" style="color: #007aff;">${stats.in_progress_count || 0}</div><div class="stat-label">🔵 В работе</div></div>
                <div class="stat-card"><div class="stat-value" style="color: #34c759;">${stats.completed_count || 0}</div><div class="stat-label">🟢 Выполнены</div></div>
                <div class="stat-card"><div class="stat-value" style="color: #ff3b30;">${stats.high_priority_count || 0}</div><div class="stat-label">🔴 Высокий приоритет</div></div>
            </div>
        `;
        
        if (stats.by_category && stats.by_category.length > 0) {
            let catHtml = '<div class="card" style="margin-top: 0;"><h4>📊 По категориям</h4><div class="stats-grid" style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));">';
            stats.by_category.forEach(cat => {
                catHtml += `<div class="stat-card"><div class="stat-value" style="font-size: 18px;">${cat.count}</div><div class="stat-label">${getCategoryText(cat.category)}</div></div>`;
            });
            catHtml += '</div></div>';
            container.innerHTML += catHtml;
        }
        
    } catch (err) {
        container.innerHTML = '<div class="card">Ошибка загрузки статистики</div>';
    }
}

async function loadBranches() {
    const container = document.getElementById('branchesList');
    if (!container) return;
    
    try {
        const response = await fetch(`${API_URL}/api/branches`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const branches = await response.json();
        
        container.innerHTML = `
            <table class="branches-table">
                ${branches.filter(b => !b.is_admin).map(branch => `
                    <tr>
                        <td><strong>${branch.name}</strong><br><small>${branch.login}</small></td>
                        <td><input type="email" id="email-${branch.id}" class="email-input" value="${branch.email || ''}" placeholder="email@example.ru"></td>
                        <td><button class="save-email-btn" onclick="saveBranchEmail(${branch.id})">Сохранить</button></td>
                    </tr>
                `).join('')}
            </table>
            <div style="margin-top: 8px; font-size: 12px; color: #666;">
                ✉️ Укажите email для каждого филиала — заведующие будут получать уведомления об изменении статуса заявок.
            </div>
        `;
        
    } catch (err) {
        container.innerHTML = '<div>Ошибка загрузки списка филиалов</div>';
    }
}

window.saveBranchEmail = async function(branchId) {
    const input = document.getElementById(`email-${branchId}`);
    const email = input.value;
    
    try {
        const response = await fetch(`${API_URL}/api/branches/${branchId}/email`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ email })
        });
        
        if (response.ok) {
            input.style.border = '2px solid #34c759';
            setTimeout(() => input.style.border = '', 2000);
            showToast('Email сохранён');
        } else {
            alert('Ошибка сохранения');
        }
    } catch (err) {
        alert('Ошибка соединения');
    }
};

async function loadAdminTickets() {
    const container = document.getElementById('ticketsList');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center;">Загрузка...</div>';
    
    const params = new URLSearchParams();
    if (currentFilters.status && currentFilters.status !== 'all') params.append('status', currentFilters.status);
    if (currentFilters.priority && currentFilters.priority !== 'all') params.append('priority', currentFilters.priority);
    if (currentFilters.branch) params.append('branch', currentFilters.branch);
    if (currentFilters.search) params.append('search', currentFilters.search);
    
    const url = `${API_URL}/api/tickets${params.toString() ? '?' + params.toString() : ''}`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const tickets = await response.json();
        
        const countSpan = document.getElementById('ticketsCount');
        if (countSpan) countSpan.textContent = `(${tickets.length})`;
        
        if (tickets.length === 0) {
            container.innerHTML = '<p style="text-align: center;">Нет заявок по заданным фильтрам</p>';
            return;
        }
        
        let html = '';
        for (const ticket of tickets) {
            const priorityClass = ticket.priority === 'high' ? 'priority-high' : 
                                 (ticket.priority === 'medium' ? 'priority-medium' : 'priority-low');
            
            html += `
                <div class="ticket-item ${priorityClass}" data-id="${ticket.id}">
                    <div>
                        <strong>№${ticket.id}</strong>
                        <button class="copy-btn" data-id="${ticket.id}" onclick="copyTicketId(${ticket.id})" style="background: none; border: none; cursor: pointer; font-size: 14px;">📋</button>
                        — ${ticket.branch_name}
                    </div>
                    <div><small>${new Date(ticket.created_at).toLocaleString('ru-RU')}</small></div>
                    <div><strong>Категория:</strong> ${getCategoryText(ticket.category)}</div>
                    <div><strong>Срочность:</strong> ${getPriorityText(ticket.priority)}</div>
                    <div><strong>Проблема:</strong> ${ticket.problem}</div>
                    ${ticket.photo_path ? `<img src="${ticket.photo_path}" class="ticket-photo" onclick="window.open(this.src)">` : ''}
                    <div style="margin-top: 8px;">
                        <strong>Статус:</strong>
                        <select class="status-select" data-id="${ticket.id}" data-status="${ticket.status}">
                            <option value="new" ${ticket.status === 'new' ? 'selected' : ''}>🟡 Новая</option>
                            <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>🔵 В работе</option>
                            <option value="completed" ${ticket.status === 'completed' ? 'selected' : ''}>🟢 Выполнена</option>
                            <option value="cancelled" ${ticket.status === 'cancelled' ? 'selected' : ''}>🔴 Отменена</option>
                        </select>
                    </div>
                    <div style="margin-top: 8px;">
                        <input type="text" id="comment-${ticket.id}" class="comment-input" placeholder="➕ Комментарий для заведующей" style="width: calc(100% - 100px);">
                        <button onclick="updateTicketStatus(${ticket.id}, this)" style="margin-left: 8px;">Применить</button>
                    </div>
                    <div style="margin-top: 8px;">
                        <button onclick="showHistory(${ticket.id})" style="background: #8e8e93; color: white; border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 12px;">📜 История</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
        
    } catch (err) {
        container.innerHTML = '<p style="text-align: center;">Ошибка загрузки заявок</p>';
    }
}

function applyFilters() {
    currentFilters.status = document.getElementById('filterStatus').value;
    currentFilters.priority = document.getElementById('filterPriority').value;
    currentFilters.branch = document.getElementById('filterBranch').value;
    currentFilters.search = document.getElementById('filterSearch').value;
    loadAdminTickets();
}

function resetFilters() {
    document.getElementById('filterStatus').value = 'all';
    document.getElementById('filterPriority').value = 'all';
    document.getElementById('filterBranch').value = '';
    document.getElementById('filterSearch').value = '';
    currentFilters = { status: 'all', priority: 'all', branch: '', search: '' };
    loadAdminTickets();
}

async function exportToExcel() {
    const exportBtn = document.getElementById('exportExcel');
    exportBtn.disabled = true;
    exportBtn.textContent = '⏳ Подготовка...';
    
    const params = new URLSearchParams();
    if (currentFilters.status && currentFilters.status !== 'all') params.append('status', currentFilters.status);
    if (currentFilters.priority && currentFilters.priority !== 'all') params.append('priority', currentFilters.priority);
    if (currentFilters.branch) params.append('branch', currentFilters.branch);
    if (currentFilters.search) params.append('search', currentFilters.search);
    
    const url = `${API_URL}/api/export${params.toString() ? '?' + params.toString() : ''}`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const link = document.createElement('a');
            const objectUrl = URL.createObjectURL(blob);
            link.href = objectUrl;
            
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'заявки.xlsx';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            }
            link.download = filename;
            link.click();
            URL.revokeObjectURL(objectUrl);
            showToast('Файл Excel скачан');
        } else {
            showToast('Ошибка при экспорте');
        }
    } catch (err) {
        showToast('Ошибка соединения');
    } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '📊 Экспорт в Excel';
    }
}

window.updateTicketStatus = async function(ticketId, button) {
    const select = document.querySelector(`.status-select[data-id="${ticketId}"]`);
    const status = select.value;
    const commentInput = document.getElementById(`comment-${ticketId}`);
    const comment = commentInput.value;
    
    button.disabled = true;
    button.textContent = '⏳';
    
    try {
        const response = await fetch(`${API_URL}/api/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status, comment: comment || undefined })
        });
        
        if (response.ok) {
            commentInput.value = '';
            button.textContent = '✅';
            setTimeout(() => {
                button.textContent = 'Применить';
                button.disabled = false;
            }, 1500);
            await loadAdminTickets();
            await loadStats();
            showToast('Статус обновлён');
        } else {
            button.textContent = 'Применить';
            button.disabled = false;
            alert('Ошибка обновления');
        }
    } catch (err) {
        button.textContent = 'Применить';
        button.disabled = false;
        alert('Ошибка соединения');
    }
};

// ============ ИСТОРИЯ ЗАЯВКИ (МОДАЛЬНОЕ ОКНО) ============

function createHistoryModal() {
    if (document.getElementById('historyModal')) return;
    
    const modal = document.createElement('div');
    modal.id = 'historyModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 10001;
    `;
    
    modal.innerHTML = `
        <div style="background: white; border-radius: 12px; max-width: 500px; width: 90%; max-height: 80%; overflow: auto; padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3>📜 История изменений</h3>
                <button onclick="closeHistoryModal()" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div id="historyContent"></div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

window.closeHistoryModal = function() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'none';
};

window.showHistory = async function(ticketId) {
    createHistoryModal();
    const modal = document.getElementById('historyModal');
    const content = document.getElementById('historyContent');
    
    content.innerHTML = '<div style="text-align: center;">Загрузка...</div>';
    modal.style.display = 'flex';
    
    try {
        const response = await fetch(`${API_URL}/api/tickets/${ticketId}/history`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const history = await response.json();
        
        if (history.length === 0) {
            content.innerHTML = '<p style="text-align: center;">История пуста</p>';
            return;
        }
        
        const actionMap = {
            'create': '🆕 Создание заявки',
            'status_change': '📝 Изменение статуса',
            'comment': '💬 Добавлен комментарий'
        };
        
        content.innerHTML = history.map(h => `
            <div style="border-bottom: 1px solid #eee; padding: 10px 0;">
                <div style="display: flex; justify-content: space-between;">
                    <strong>${actionMap[h.action] || h.action}</strong>
                    <span style="font-size: 12px; color: #666;">${new Date(h.created_at).toLocaleString('ru-RU')}</span>
                </div>
                <div style="font-size: 12px; color: #007aff;">👤 ${h.user_name}</div>
                <div style="margin-top: 5px; font-size: 14px;">
                    ${h.action === 'status_change' ? `Статус: "${h.old_value}" → "${h.new_value}"` : ''}
                    ${h.action === 'comment' ? `Комментарий: "${h.new_value}"` : ''}
                    ${h.action === 'create' ? `Создана заявка` : ''}
                </div>
            </div>
        `).join('');
        
    } catch (err) {
        content.innerHTML = '<p style="text-align: center;">Ошибка загрузки истории</p>';
    }
};

document.addEventListener('click', (e) => {
    const modal = document.getElementById('historyModal');
    if (modal && e.target === modal) {
        modal.style.display = 'none';
    }
});

// Переключение видимости комментариев для заведующей
window.toggleUserComments = async function(ticketId) {
    const commentsList = document.getElementById(`user-comments-list-${ticketId}`);
    const commentForm = document.getElementById(`user-comment-form-${ticketId}`);
    const icon = document.getElementById(`comments-toggle-icon-${ticketId}`);
    
    if (commentsList.style.display === 'none') {
        await loadUserComments(ticketId);
        commentsList.style.display = 'block';
        commentForm.style.display = 'block';
        icon.textContent = '▲';
    } else {
        commentsList.style.display = 'none';
        commentForm.style.display = 'none';
        icon.textContent = '▼';
    }
};

// Загрузка комментариев для заведующей
async function loadUserComments(ticketId) {
    const container = document.getElementById(`user-comments-list-${ticketId}`);
    if (!container) return;
    
    container.innerHTML = '<div style="font-size: 12px; color: #666;">Загрузка...</div>';
    
    try {
        const response = await fetch(`${API_URL}/api/tickets/${ticketId}/comments`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const comments = await response.json();
        
        if (comments.length === 0) {
            container.innerHTML = '<div style="font-size: 12px; color: #999;">Нет комментариев</div>';
            return;
        }
        
        container.innerHTML = comments.map(comment => `
            <div style="background: #f8f9fa; padding: 8px; border-radius: 8px; margin-bottom: 6px;">
                <div style="display: flex; justify-content: space-between;">
                    <strong style="font-size: 12px; color: #007aff;">${escapeHtml(comment.user_name)}</strong>
                    <span style="font-size: 10px; color: #999;">${new Date(comment.created_at).toLocaleString('ru-RU')}</span>
                </div>
                <div style="font-size: 13px; margin-top: 4px;">${escapeHtml(comment.comment)}</div>
            </div>
        `).join('');
        
    } catch (err) {
        container.innerHTML = '<div style="color: red;">Ошибка загрузки</div>';
    }
}

// Отправка комментария от заведующей
window.submitUserComment = async function(ticketId) {
    const input = document.getElementById(`user-comment-input-${ticketId}`);
    const comment = input.value.trim();
    
    if (!comment) {
        showToast('Напишите комментарий');
        return;
    }
    
    const btn = input.nextElementSibling;
    btn.disabled = true;
    btn.textContent = 'Отправка...';
    
    try {
        const response = await fetch(`${API_URL}/api/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ comment })
        });
        
        if (response.ok) {
            input.value = '';
            await loadUserComments(ticketId);
            showToast('Комментарий отправлен');
        } else {
            showToast('Ошибка отправки');
        }
    } catch (err) {
        showToast('Ошибка соединения');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Отправить';
    }
};

// Экранирование HTML
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}