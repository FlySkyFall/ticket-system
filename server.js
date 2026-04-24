require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { sendNewTicketNotification, sendStatusChangeNotification } = require('./utils/mailer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// Создаём необходимые папки
const folders = ['database', 'uploads', 'public'];
folders.forEach(folder => {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// В самом начале, после импортов
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'database', 'tickets.db');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Инициализация базы данных
const dbPath = path.join(__dirname, 'database', 'tickets.db');
const db = new sqlite3.Database(dbPath);

// Функция для проверки существования колонки
function columnExists(tableName, columnName, callback) {
    db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
        if (err) return callback(false);
        const exists = columns.some(col => col.name === columnName);
        callback(exists);
    });
}

// Функция записи в историю
function addToHistory(ticketId, action, oldValue, newValue, userName) {
    db.run(`
        INSERT INTO ticket_history (ticket_id, action, old_value, new_value, user_name, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [ticketId, action, oldValue || null, newValue || null, userName], (err) => {
        if (err) console.error('Ошибка записи в историю:', err.message);
    });
}

// Создание/миграция таблиц
db.serialize(() => {
    // 1. Таблица branches (с email)
    db.run(`
        CREATE TABLE IF NOT EXISTS branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            login TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            is_admin INTEGER DEFAULT 0
        )
    `);
    
    // 2. Таблица tickets
    db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            branch_id INTEGER NOT NULL,
            branch_name TEXT NOT NULL,
            problem TEXT NOT NULL,
            photo_path TEXT,
            status TEXT DEFAULT 'new',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (branch_id) REFERENCES branches(id)
        )
    `);
    
    // Добавляем колонку category, если её нет
    columnExists('tickets', 'category', (exists) => {
        if (!exists) {
            db.run(`ALTER TABLE tickets ADD COLUMN category TEXT DEFAULT 'other'`, (err) => {
                if (err) console.log('⚠️ Не удалось добавить category:', err.message);
                else console.log('✅ Добавлена колонка category');
            });
        }
    });
    
    // Добавляем колонку priority, если её нет
    columnExists('tickets', 'priority', (exists) => {
        if (!exists) {
            db.run(`ALTER TABLE tickets ADD COLUMN priority TEXT DEFAULT 'medium'`, (err) => {
                if (err) console.log('⚠️ Не удалось добавить priority:', err.message);
                else console.log('✅ Добавлена колонка priority');
            });
        }
    });
    
    // 3. Таблица комментариев
    db.run(`
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ticket_id) REFERENCES tickets(id)
        )
    `);
    
    // 4. Таблица истории изменений
    db.run(`
        CREATE TABLE IF NOT EXISTS ticket_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            user_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ticket_id) REFERENCES tickets(id)
        )
    `);
    
    // 5. Добавляем тестовые филиалы (только если таблица пустая)
    db.get(`SELECT COUNT(*) as count FROM branches`, (err, row) => {
        if (row && row.count === 0) {
            const testBranches = [
                ['Филиал Северный', 'sever', bcrypt.hashSync('12345', 10), 'sever@example.ru', 0],
                ['Филиал Южный', 'ug', bcrypt.hashSync('12345', 10), 'ug@example.ru', 0],
                ['Филиал Восточный', 'vostok', bcrypt.hashSync('12345', 10), 'vostok@example.ru', 0],
                ['Филиал Западный', 'zapad', bcrypt.hashSync('12345', 10), 'zapad@example.ru', 0],
                ['Филиал Центральный', 'center', bcrypt.hashSync('12345', 10), 'center@example.ru', 0],
                ['Администратор', 'admin', bcrypt.hashSync('admin123', 10), null, 1]
            ];
            
            const stmt = db.prepare(`INSERT INTO branches (name, login, password_hash, email, is_admin) VALUES (?, ?, ?, ?, ?)`);
            testBranches.forEach(b => stmt.run(b));
            stmt.finalize();
            
            console.log('✅ Добавлены тестовые филиалы');
            console.log('👤 Администратор: admin / admin123');
            console.log('🏢 Филиалы: sever, ug, vostok, zapad, center (пароль 12345)');
        } else {
            console.log('📁 База данных уже существует, пропускаем создание тестовых филиалов');
        }
    });
});

// ============ API ЭНДПОИНТЫ ============

// Логин
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    
    if (!login || !password) {
        return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    
    db.get(`SELECT * FROM branches WHERE login = ?`, [login], (err, branch) => {
        if (err || !branch) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        bcrypt.compare(password, branch.password_hash, (err, result) => {
            if (err || !result) {
                return res.status(401).json({ error: 'Неверный логин или пароль' });
            }
            
            const token = jwt.sign(
                { 
                    id: branch.id, 
                    login: branch.login, 
                    name: branch.name,
                    email: branch.email,
                    isAdmin: branch.is_admin === 1 
                },
                JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            res.json({
                token,
                user: {
                    id: branch.id,
                    name: branch.name,
                    email: branch.email,
                    isAdmin: branch.is_admin === 1
                }
            });
        });
    });
});

// Middleware для проверки токена
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Нет токена авторизации' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Неверный формат токена' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Токен истёк или недействителен' });
    }
}

// Настройка multer для фото
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

// Создание новой заявки
app.post('/api/tickets', authMiddleware, upload.single('photo'), (req, res) => {
    const { problem, category, priority } = req.body;
    const branch_id = req.user.id;
    const branch_name = req.user.name;
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;
    
    if (!problem || problem.trim() === '') {
        return res.status(400).json({ error: 'Опишите проблему' });
    }
    
    const finalCategory = category || 'other';
    const finalPriority = priority || 'medium';
    
    db.run(`
        INSERT INTO tickets (branch_id, branch_name, category, priority, problem, photo_path, status)
        VALUES (?, ?, ?, ?, ?, ?, 'new')
    `, [branch_id, branch_name, finalCategory, finalPriority, problem, photo_path], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка при создании заявки' });
        }
        
        const ticketId = this.lastID;
        
        // Записываем в историю
        addToHistory(ticketId, 'create', null, JSON.stringify({ problem, finalCategory, finalPriority }), branch_name);
        
        // Получаем полные данные заявки для отправки уведомления
        db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], async (err, ticket) => {
            if (!err && ticket) {
                await sendNewTicketNotification(ticket, branch_name);
            }
        });
        
        res.json({
            id: ticketId,
            message: 'Заявка создана',
            status: 'new'
        });
    });
});

// Получение заявок (с фильтрацией)
app.get('/api/tickets', authMiddleware, (req, res) => {
    const { status, priority, branch, search } = req.query;
    let query = `SELECT * FROM tickets`;
    let params = [];
    let conditions = [];
    
    // Для обычного пользователя — только свои заявки
    if (!req.user.isAdmin) {
        conditions.push(`branch_id = ?`);
        params.push(req.user.id);
    }
    
    // Фильтр по статусу
    if (status && status !== 'all') {
        conditions.push(`status = ?`);
        params.push(status);
    }
    
    // Фильтр по приоритету
    if (priority && priority !== 'all') {
        conditions.push(`priority = ?`);
        params.push(priority);
    }
    
    // Фильтр по филиалу (только для админа)
    if (branch && branch.trim() && req.user.isAdmin) {
        conditions.push(`branch_name LIKE ?`);
        params.push(`%${branch}%`);
    }
    
    // Поиск по тексту проблемы
    if (search && search.trim()) {
        conditions.push(`problem LIKE ?`);
        params.push(`%${search}%`);
    }
    
    if (conditions.length) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    
    // Сортировка: сначала по приоритету, потом по дате
    query += ` ORDER BY 
        CASE priority 
            WHEN 'high' THEN 1 
            WHEN 'medium' THEN 2 
            WHEN 'low' THEN 3 
        END, created_at DESC`;
    
    db.all(query, params, (err, tickets) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка получения заявок' });
        }
        res.json(tickets);
    });
});

// Обновление статуса заявки
app.put('/api/tickets/:id/status', authMiddleware, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const { status, comment } = req.body;
    const validStatuses = ['new', 'in_progress', 'completed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }
    
    // Сначала получаем старый статус и данные заявки
    db.get(`SELECT * FROM tickets WHERE id = ?`, [req.params.id], async (err, ticket) => {
        if (err || !ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const oldStatus = ticket.status;
        
        // Обновляем статус
        db.run(`UPDATE tickets SET status = ? WHERE id = ?`, [status, req.params.id], async function(err) {
            if (err) {
                return res.status(500).json({ error: 'Ошибка обновления' });
            }
            
            // Записываем в историю
            addToHistory(req.params.id, 'status_change', oldStatus, status, req.user.name);
            
            // Если есть комментарий, сохраняем его
            if (comment && comment.trim()) {
                db.run(`INSERT INTO comments (ticket_id, user_name, comment) VALUES (?, ?, ?)`,
                    [req.params.id, req.user.name, comment]);
                addToHistory(req.params.id, 'comment', null, comment, req.user.name);
            }
            
            // Отправляем уведомление заведующей, если у неё есть email
            if (ticket.branch_id) {
                db.get(`SELECT email FROM branches WHERE id = ?`, [ticket.branch_id], async (err, branch) => {
                    if (!err && branch && branch.email) {
                        await sendStatusChangeNotification(ticket, ticket.branch_name, branch.email, oldStatus, status, comment);
                    }
                });
            }
            
            res.json({ message: 'Статус обновлён' });
        });
    });
});

// Получение комментариев к заявке
app.get('/api/tickets/:id/comments', authMiddleware, (req, res) => {
    db.all(`SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC`, [req.params.id], (err, comments) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения комментариев' });
        }
        res.json(comments);
    });
});

// Добавление комментария (для заведующих)
app.post('/api/tickets/:id/comments', authMiddleware, (req, res) => {
    const { comment } = req.body;
    
    if (!comment || comment.trim() === '') {
        return res.status(400).json({ error: 'Введите комментарий' });
    }
    
    // Проверяем, имеет ли пользователь доступ к этой заявке
    let query = `SELECT * FROM tickets WHERE id = ?`;
    let params = [req.params.id];
    
    if (!req.user.isAdmin) {
        query += ` AND branch_id = ?`;
        params.push(req.user.id);
    }
    
    db.get(query, params, (err, ticket) => {
        if (err || !ticket) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
        db.run(`INSERT INTO comments (ticket_id, user_name, comment) VALUES (?, ?, ?)`,
            [req.params.id, req.user.name, comment], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Ошибка добавления комментария' });
            }
            
            // Записываем в историю
            addToHistory(req.params.id, 'comment', null, comment, req.user.name);
            
            res.json({ id: this.lastID, message: 'Комментарий добавлен' });
        });
    });
});

// Получение истории заявки
app.get('/api/tickets/:id/history', authMiddleware, (req, res) => {
    // Проверяем доступ
    let query = `SELECT * FROM tickets WHERE id = ?`;
    let params = [req.params.id];
    
    if (!req.user.isAdmin) {
        query += ` AND branch_id = ?`;
        params.push(req.user.id);
    }
    
    db.get(query, params, (err, ticket) => {
        if (err || !ticket) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
        db.all(`
            SELECT * FROM ticket_history 
            WHERE ticket_id = ? 
            ORDER BY created_at ASC
        `, [req.params.id], (err, history) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка получения истории' });
            }
            res.json(history);
        });
    });
});

// Получение статистики (только для админа)
app.get('/api/stats', authMiddleware, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    db.all(`SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority_count,
        SUM(CASE WHEN priority = 'medium' THEN 1 ELSE 0 END) as medium_priority_count,
        SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low_priority_count
        FROM tickets`, [], (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения статистики' });
        }
        
        // Статистика по категориям
        db.all(`SELECT category, COUNT(*) as count FROM tickets GROUP BY category`, [], (err, categoryStats) => {
            res.json({
                ...stats[0],
                by_category: categoryStats
            });
        });
    });
});

// Получение списка филиалов (для админа)
app.get('/api/branches', authMiddleware, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    db.all(`SELECT id, name, login, email, is_admin FROM branches`, [], (err, branches) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения списка филиалов' });
        }
        res.json(branches);
    });
});

// Обновление email филиала (только для админа)
app.put('/api/branches/:id/email', authMiddleware, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const { email } = req.body;
    db.run(`UPDATE branches SET email = ? WHERE id = ?`, [email, req.params.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Ошибка обновления email' });
        }
        res.json({ message: 'Email обновлён' });
    });
});

// Экспорт в Excel
app.get('/api/export', authMiddleware, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const { status, priority, branch, search } = req.query;
    let query = `SELECT * FROM tickets`;
    let params = [];
    let conditions = [];
    
    if (status && status !== 'all') {
        conditions.push(`status = ?`);
        params.push(status);
    }
    
    if (priority && priority !== 'all') {
        conditions.push(`priority = ?`);
        params.push(priority);
    }
    
    if (branch && branch.trim()) {
        conditions.push(`branch_name LIKE ?`);
        params.push(`%${branch}%`);
    }
    
    if (search && search.trim()) {
        conditions.push(`problem LIKE ?`);
        params.push(`%${search}%`);
    }
    
    if (conditions.length) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    
    query += ` ORDER BY created_at DESC`;
    
    db.all(query, params, (err, tickets) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }
        
        const categoryMap = {
            'computer': 'Компьютер/ноутбук',
            'printer': 'Принтер/МФУ',
            'network': 'Сеть/интернет',
            'phone': 'Телефония',
            'electric': 'Электрика',
            'furniture': 'Мебель/инвентарь',
            'other': 'Другое'
        };
        
        const priorityMap = {
            'high': 'Высокий',
            'medium': 'Средний',
            'low': 'Низкий'
        };
        
        const statusMap = {
            'new': 'Новая',
            'in_progress': 'В работе',
            'completed': 'Выполнена',
            'cancelled': 'Отменена'
        };
        
        const excelData = tickets.map(t => ({
            '№': t.id,
            'Филиал': t.branch_name,
            'Категория': categoryMap[t.category] || t.category,
            'Приоритет': priorityMap[t.priority] || t.priority,
            'Статус': statusMap[t.status] || t.status,
            'Описание проблемы': t.problem,
            'Дата создания': new Date(t.created_at).toLocaleString('ru-RU'),
            'Фото': t.photo_path ? `${process.env.APP_URL || 'http://localhost:3000'}${t.photo_path}` : 'Нет'
        }));
        
        const ws = XLSX.utils.json_to_sheet(excelData);
        ws['!cols'] = [
            { wch: 8 }, { wch: 20 }, { wch: 18 }, { wch: 12 },
            { wch: 12 }, { wch: 50 }, { wch: 20 }, { wch: 40 }
        ];
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Zayavki');
        
        const statsData = [
            { 'Показатель': 'Vsego zayavok', 'Значение': tickets.length },
            { 'Показатель': 'Novyh', 'Значение': tickets.filter(t => t.status === 'new').length },
            { 'Показатель': 'V rabote', 'Значение': tickets.filter(t => t.status === 'in_progress').length },
            { 'Показатель': 'Vypolneno', 'Значение': tickets.filter(t => t.status === 'completed').length },
            { 'Показатель': 'Otmeneno', 'Значение': tickets.filter(t => t.status === 'cancelled').length },
            { 'Показатель': 'Vysokiy prioritet', 'Значение': tickets.filter(t => t.priority === 'high').length },
        ];
        const wsStats = XLSX.utils.json_to_sheet(statsData);
        XLSX.utils.book_append_sheet(wb, wsStats, 'Statistika');
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        // ИСПРАВЛЕНО: имя файла только из латиницы, цифр и знаков _.-
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const filename = `tickets_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.xlsx`;
        
        // Безопасная установка заголовка (только латиница в имени файла)
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    });
});

// Ping для поддержания активности
app.get('/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📧 Почтовые уведомления: ${process.env.NOTIFY_EMAIL || 'не настроены'}`);
});