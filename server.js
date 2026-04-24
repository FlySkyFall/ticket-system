require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');
const { sendNewTicketNotification, sendStatusChangeNotification } = require('./utils/mailer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// MongoDB подключение
const MONGODB_URI = process.env.MONGODB_URI;
const client = new MongoClient(MONGODB_URI);
let db;
let ticketsCollection;
let branchesCollection;
let commentsCollection;
let historyCollection;

// Создаём необходимые папки
const folders = ['uploads', 'public'];
folders.forEach(folder => {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Счётчик для числовых ID заявок (для совместимости с фронтендом)
let ticketCounter = 1;

// ============ ФУНКЦИЯ ПОДКЛЮЧЕНИЯ К MONGODB ============
async function connectDB() {
    try {
        await client.connect();
        db = client.db('ticket_system');
        ticketsCollection = db.collection('tickets');
        branchesCollection = db.collection('branches');
        commentsCollection = db.collection('comments');
        historyCollection = db.collection('history');
        
        console.log('✅ Подключено к MongoDB Atlas');
        
        // Создаём индексы
        await ticketsCollection.createIndex({ numeric_id: 1 }, { unique: true });
        await ticketsCollection.createIndex({ branch_id: 1 });
        await ticketsCollection.createIndex({ status: 1 });
        await branchesCollection.createIndex({ login: 1 }, { unique: true });
        
        // Получаем текущий максимальный numeric_id
        const lastTicket = await ticketsCollection.findOne({}, { sort: { numeric_id: -1 } });
        if (lastTicket && lastTicket.numeric_id) {
            ticketCounter = lastTicket.numeric_id + 1;
        }
        
        // Создаём пользователей
        await createUsers();
        
    } catch (err) {
        console.error('❌ Ошибка подключения к MongoDB:', err);
        process.exit(1);
    }
}

// ============ СОЗДАНИЕ ПОЛЬЗОВАТЕЛЕЙ ============
async function createUsers() {
    const userCount = await branchesCollection.countDocuments();
    if (userCount > 0) {
        console.log(`📁 Пользователи уже существуют (${userCount} записей)`);
        return;
    }
    
    // 2 Администратора
    const admins = [
        {
            name: 'Главный администратор',
            login: 'admin',
            password_hash: await bcrypt.hash('admin123', 10),
            email: null,
            is_admin: 1,
            created_at: new Date()
        },
        {
            name: 'Второй администратор',
            login: 'admin2',
            password_hash: await bcrypt.hash('admin123', 10),
            email: null,
            is_admin: 1,
            created_at: new Date()
        }
    ];
    
    // 11 Филиалов
    const branches = [
        { name: 'Филиал Северный', login: 'sever', password: '12345', email: 'sever@example.ru' },
        { name: 'Филиал Южный', login: 'ug', password: '12345', email: 'ug@example.ru' },
        { name: 'Филиал Восточный', login: 'vostok', password: '12345', email: 'vostok@example.ru' },
        { name: 'Филиал Западный', login: 'zapad', password: '12345', email: 'zapad@example.ru' },
        { name: 'Филиал Центральный', login: 'center', password: '12345', email: 'center@example.ru' },
        { name: 'Филиал Северо-Западный', login: 'sever_zapad', password: '12345', email: 'sever_zapad@example.ru' },
        { name: 'Филиал Северо-Восточный', login: 'sever_vostok', password: '12345', email: 'sever_vostok@example.ru' },
        { name: 'Филиал Юго-Западный', login: 'ug_zapad', password: '12345', email: 'ug_zapad@example.ru' },
        { name: 'Филиал Юго-Восточный', login: 'ug_vostok', password: '12345', email: 'ug_vostok@example.ru' },
        { name: 'Филиал Подольский', login: 'podolsk', password: '12345', email: 'podolsk@example.ru' },
        { name: 'Филиал Красногорский', login: 'krasnogorsk', password: '12345', email: 'krasnogorsk@example.ru' }
    ];
    
    const branchUsers = [];
    for (const branch of branches) {
        branchUsers.push({
            name: branch.name,
            login: branch.login,
            password_hash: await bcrypt.hash(branch.password, 10),
            email: branch.email,
            is_admin: 0,
            created_at: new Date()
        });
    }
    
    const allUsers = [...admins, ...branchUsers];
    await branchesCollection.insertMany(allUsers);
    
    console.log('✅ Созданы пользователи:');
    console.log(`   👤 Администраторы: admin/admin123, admin2/admin123`);
    console.log(`   🏢 ${branches.length} филиалов (пароль: 12345)`);
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
async function addToHistory(ticketId, action, oldValue, newValue, userName, comment = null) {
    try {
        await historyCollection.insertOne({
            ticket_numeric_id: ticketId,
            action,
            old_value: oldValue,
            new_value: newValue,
            user_name: userName,
            comment: comment,
            created_at: new Date()
        });
    } catch (err) {
        console.error('Ошибка записи в историю:', err);
    }
}

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
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ============ API ЭНДПОИНТЫ ============

// Логин
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    
    if (!login || !password) {
        return res.status(400).json({ error: 'Введите логин и пароль' });
    }
    
    try {
        const branch = await branchesCollection.findOne({ login: login });
        
        if (!branch) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        const isValid = await bcrypt.compare(password, branch.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        const token = jwt.sign(
            {
                id: branch._id.toString(),
                numeric_id: branch.numeric_id || 0,
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
                id: branch._id.toString(),
                name: branch.name,
                email: branch.email,
                isAdmin: branch.is_admin === 1
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание новой заявки
app.post('/api/tickets', authMiddleware, upload.single('photo'), async (req, res) => {
    const { problem, category, priority } = req.body;
    const branch_id = req.user.id;
    const branch_name = req.user.name;
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;
    
    if (!problem || problem.trim() === '') {
        return res.status(400).json({ error: 'Опишите проблему' });
    }
    
    const finalCategory = category || 'other';
    const finalPriority = priority || 'medium';
    const numericId = ticketCounter++;
    
    try {
        const ticket = {
            numeric_id: numericId,
            branch_id: branch_id,
            branch_name: branch_name,
            category: finalCategory,
            priority: finalPriority,
            problem: problem,
            photo_path: photo_path,
            status: 'new',
            created_at: new Date()
        };
        
        const result = await ticketsCollection.insertOne(ticket);
        
        // Записываем в историю
        await addToHistory(numericId, 'create', null, JSON.stringify({ problem, finalCategory, finalPriority }), branch_name);
        
        // Отправляем уведомление
        const ticketForNotify = { ...ticket, id: numericId };
        await sendNewTicketNotification(ticketForNotify, branch_name);
        
        res.json({
            id: numericId,
            message: 'Заявка создана',
            status: 'new'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при создании заявки' });
    }
});

// Получение заявок (с фильтрацией)
app.get('/api/tickets', authMiddleware, async (req, res) => {
    const { status, priority, branch, search } = req.query;
    let filter = {};
    
    if (!req.user.isAdmin) {
        filter.branch_id = req.user.id;
    }
    
    if (status && status !== 'all') {
        filter.status = status;
    }
    
    if (priority && priority !== 'all') {
        filter.priority = priority;
    }
    
    if (branch && branch.trim() && req.user.isAdmin) {
        filter.branch_name = { $regex: branch, $options: 'i' };
    }
    
    if (search && search.trim()) {
        filter.problem = { $regex: search, $options: 'i' };
    }
    
    try {
        let tickets = await ticketsCollection.find(filter).toArray();
        
        // Сортировка
        const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
        tickets.sort((a, b) => {
            const priorityCompare = priorityOrder[a.priority] - priorityOrder[b.priority];
            if (priorityCompare !== 0) return priorityCompare;
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        // Преобразуем для фронтенда: id = numeric_id
        const ticketsWithId = tickets.map(t => ({
            id: t.numeric_id,
            branch_id: t.branch_id,
            branch_name: t.branch_name,
            category: t.category,
            priority: t.priority,
            problem: t.problem,
            photo_path: t.photo_path,
            status: t.status,
            created_at: t.created_at
        }));
        
        res.json(ticketsWithId);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения заявок' });
    }
});

// Обновление статуса заявки
app.put('/api/tickets/:id/status', authMiddleware, async (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const { status, comment } = req.body;
    const validStatuses = ['new', 'in_progress', 'completed', 'cancelled'];
    const ticketNumericId = parseInt(req.params.id);
    
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }
    
    try {
        const ticket = await ticketsCollection.findOne({ numeric_id: ticketNumericId });
        
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const oldStatus = ticket.status;
        
        await ticketsCollection.updateOne(
            { numeric_id: ticketNumericId },
            { $set: { status } }
        );
        
        await addToHistory(ticketNumericId, 'status_change', oldStatus, status, req.user.name);
        
        if (comment && comment.trim()) {
            await commentsCollection.insertOne({
                ticket_numeric_id: ticketNumericId,
                user_name: req.user.name,
                comment: comment,
                created_at: new Date()
            });
            await addToHistory(ticketNumericId, 'comment', null, comment, req.user.name);
        }
        
        // Отправляем уведомление
        if (ticket.branch_id) {
            const branch = await branchesCollection.findOne({ _id: new ObjectId(ticket.branch_id) });
            if (branch && branch.email) {
                const ticketForNotify = { ...ticket, id: ticketNumericId };
                await sendStatusChangeNotification(ticketForNotify, ticket.branch_name, branch.email, oldStatus, status, comment);
            }
        }
        
        res.json({ message: 'Статус обновлён' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления' });
    }
});

// Получение комментариев к заявке
app.get('/api/tickets/:id/comments', authMiddleware, async (req, res) => {
    try {
        const ticketNumericId = parseInt(req.params.id);
        
        const ticket = await ticketsCollection.findOne({ numeric_id: ticketNumericId });
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        if (!req.user.isAdmin && ticket.branch_id !== req.user.id) {
            return res.status(403).json({ error: 'Нет доступа' });
        }
        
        const comments = await commentsCollection.find({ ticket_numeric_id: ticketNumericId })
            .sort({ created_at: 1 })
            .toArray();
        
        res.json(comments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения комментариев' });
    }
});

// Добавление комментария
app.post('/api/tickets/:id/comments', authMiddleware, async (req, res) => {
    const { comment } = req.body;
    const ticketNumericId = parseInt(req.params.id);
    
    if (!comment || comment.trim() === '') {
        return res.status(400).json({ error: 'Введите комментарий' });
    }
    
    try {
        const ticket = await ticketsCollection.findOne({ numeric_id: ticketNumericId });
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        if (!req.user.isAdmin && ticket.branch_id !== req.user.id) {
            return res.status(403).json({ error: 'Нет доступа' });
        }
        
        await commentsCollection.insertOne({
            ticket_numeric_id: ticketNumericId,
            user_name: req.user.name,
            comment: comment,
            created_at: new Date()
        });
        
        await addToHistory(ticketNumericId, 'comment', null, comment, req.user.name);
        
        res.json({ message: 'Комментарий добавлен' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка добавления комментария' });
    }
});

// Получение истории заявки
app.get('/api/tickets/:id/history', authMiddleware, async (req, res) => {
    try {
        const ticketNumericId = parseInt(req.params.id);
        
        const ticket = await ticketsCollection.findOne({ numeric_id: ticketNumericId });
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        if (!req.user.isAdmin && ticket.branch_id !== req.user.id) {
            return res.status(403).json({ error: 'Нет доступа' });
        }
        
        const history = await historyCollection.find({ ticket_numeric_id: ticketNumericId })
            .sort({ created_at: 1 })
            .toArray();
        
        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения истории' });
    }
});

// Получение статистики
app.get('/api/stats', authMiddleware, async (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    try {
        const tickets = await ticketsCollection.find({}).toArray();
        
        const total = tickets.length;
        const new_count = tickets.filter(t => t.status === 'new').length;
        const in_progress_count = tickets.filter(t => t.status === 'in_progress').length;
        const completed_count = tickets.filter(t => t.status === 'completed').length;
        const cancelled_count = tickets.filter(t => t.status === 'cancelled').length;
        const high_priority_count = tickets.filter(t => t.priority === 'high').length;
        const medium_priority_count = tickets.filter(t => t.priority === 'medium').length;
        const low_priority_count = tickets.filter(t => t.priority === 'low').length;
        
        // Статистика по категориям
        const categoryMap = {};
        tickets.forEach(t => {
            const cat = t.category || 'other';
            categoryMap[cat] = (categoryMap[cat] || 0) + 1;
        });
        const by_category = Object.entries(categoryMap).map(([category, count]) => ({ category, count }));
        
        res.json({
            total,
            new_count,
            in_progress_count,
            completed_count,
            cancelled_count,
            high_priority_count,
            medium_priority_count,
            low_priority_count,
            by_category
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Получение списка филиалов
app.get('/api/branches', authMiddleware, async (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    try {
        const branches = await branchesCollection.find({})
            .project({ _id: 1, name: 1, login: 1, email: 1, is_admin: 1 })
            .toArray();
        
        const branchesWithId = branches.map(b => ({
            id: b._id.toString(),
            name: b.name,
            login: b.login,
            email: b.email,
            is_admin: b.is_admin
        }));
        
        res.json(branchesWithId);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения списка филиалов' });
    }
});

// Обновление email филиала
app.put('/api/branches/:id/email', authMiddleware, async (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const { email } = req.body;
    
    try {
        const branchId = new ObjectId(req.params.id);
        await branchesCollection.updateOne(
            { _id: branchId },
            { $set: { email: email } }
        );
        res.json({ message: 'Email обновлён' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления email' });
    }
});

// Экспорт в Excel
app.get('/api/export', authMiddleware, async (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const { status, priority, branch, search } = req.query;
    let filter = {};
    
    if (status && status !== 'all') filter.status = status;
    if (priority && priority !== 'all') filter.priority = priority;
    if (branch && branch.trim()) filter.branch_name = { $regex: branch, $options: 'i' };
    if (search && search.trim()) filter.problem = { $regex: search, $options: 'i' };
    
    try {
        let tickets = await ticketsCollection.find(filter).toArray();
        
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
            '№': t.numeric_id,
            'Филиал': t.branch_name,
            'Категория': categoryMap[t.category] || t.category,
            'Приоритет': priorityMap[t.priority] || t.priority,
            'Статус': statusMap[t.status] || t.status,
            'Описание проблемы': t.problem,
            'Дата создания': t.created_at ? new Date(t.created_at).toLocaleString('ru-RU') : '',
            'Фото': t.photo_path ? `${process.env.APP_URL || 'http://localhost:3000'}${t.photo_path}` : 'Нет'
        }));
        
        const ws = XLSX.utils.json_to_sheet(excelData);
        ws['!cols'] = [
            { wch: 8 }, { wch: 20 }, { wch: 18 }, { wch: 12 },
            { wch: 12 }, { wch: 50 }, { wch: 20 }, { wch: 40 }
        ];
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Zayavki');
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        const now = new Date();
        const filename = `tickets_${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}.xlsx`;
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка экспорта' });
    }
});

// Ping
app.get('/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ ЗАПУСК СЕРВЕРА ============
async function startServer() {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
        console.log(`📧 Почтовые уведомления: ${process.env.NOTIFY_EMAIL || 'не настроены'}`);
    });
}

startServer();