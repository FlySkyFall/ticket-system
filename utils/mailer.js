const nodemailer = require('nodemailer');

// Создаём транспортер один раз при запуске
let transporter = null;

function initTransporter() {
    if (transporter) return transporter;
    
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true', // true для 465, false для 587
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
    
    return transporter;
}

// Отправка уведомления о новой заявке
async function sendNewTicketNotification(ticket, branchName) {
    const transporter = initTransporter();
    const notifyEmail = process.env.NOTIFY_EMAIL;
    
    if (!notifyEmail) {
        console.log('❌ NOTIFY_EMAIL не задан в .env');
        return;
    }
    
    // Текст письма в HTML
    const statusMap = {
        'high': '🔴 Высокий',
        'medium': '🟡 Средний',
        'low': '🟢 Низкий'
    };
    
    const categoryMap = {
        'computer': '🖥️ Компьютер/ноутбук',
        'printer': '🖨️ Принтер/МФУ',
        'network': '🌐 Сеть/интернет',
        'phone': '📞 Телефония',
        'electric': '🔌 Электрика',
        'furniture': '🪑 Мебель/инвентарь',
        'other': '❓ Другое'
    };
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #007aff; color: white; padding: 15px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 10px 10px; }
                .ticket-id { font-size: 24px; font-weight: bold; color: #007aff; }
                .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 8px; }
                .priority-high { background: #ffe5e5; border-left: 4px solid #ff3b30; }
                .priority-medium { background: #fff5e5; border-left: 4px solid #ff9500; }
                .priority-low { background: #e5ffe5; border-left: 4px solid #34c759; }
                .button { display: inline-block; padding: 10px 20px; background: #007aff; color: white; text-decoration: none; border-radius: 8px; margin-top: 20px; }
                .footer { margin-top: 20px; font-size: 12px; color: #999; text-align: center; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>🆕 Новая заявка #${ticket.id}</h2>
                </div>
                <div class="content">
                    <div class="info-row">
                        <strong>🏢 Филиал:</strong> ${branchName}<br>
                        <strong>📂 Категория:</strong> ${categoryMap[ticket.category] || ticket.category}<br>
                        <strong>⚡ Приоритет:</strong> <span style="color: ${ticket.priority === 'high' ? '#ff3b30' : ticket.priority === 'medium' ? '#ff9500' : '#34c759'}">${statusMap[ticket.priority]}</span><br>
                        <strong>🕐 Создана:</strong> ${new Date(ticket.created_at).toLocaleString('ru-RU')}
                    </div>
                    
                    <div class="info-row ${ticket.priority === 'high' ? 'priority-high' : ticket.priority === 'medium' ? 'priority-medium' : 'priority-low'}">
                        <strong>📝 Описание проблемы:</strong><br>
                        ${ticket.problem.replace(/\n/g, '<br>')}
                    </div>
                    
                    ${ticket.photo_path ? `
                    <div class="info-row">
                        <strong>📸 Приложено фото:</strong><br>
                        <a href="${process.env.APP_URL || 'http://localhost:3000'}${ticket.photo_path}">Открыть фото</a>
                    </div>
                    ` : ''}
                    
                    <div style="text-align: center;">
                        <a href="${process.env.APP_URL || 'http://localhost:3000'}/admin.html" class="button">🔧 Открыть админ-панель</a>
                    </div>
                </div>
                <div class="footer">
                    Это автоматическое уведомление с системы заявок.<br>
                    Не отвечайте на это письмо.
                </div>
            </div>
        </body>
        </html>
    `;
    
    const text = `
        НОВАЯ ЗАЯВКА #${ticket.id}
        
        Филиал: ${branchName}
        Категория: ${categoryMap[ticket.category] || ticket.category}
        Приоритет: ${statusMap[ticket.priority]}
        Создана: ${new Date(ticket.created_at).toLocaleString('ru-RU')}
        
        Проблема:
        ${ticket.problem}
        
        ${ticket.photo_path ? `Фото: ${process.env.APP_URL || 'http://localhost:3000'}${ticket.photo_path}` : ''}
        
        ---
        Админ-панель: ${process.env.APP_URL || 'http://localhost:3000'}/admin.html
    `;
    
    try {
        const info = await transporter.sendMail({
            from: `"Система заявок" <${process.env.SMTP_USER}>`,
            to: notifyEmail,
            subject: `🆕 Новая заявка #${ticket.id} от ${branchName}`,
            text: text,
            html: html,
        });
        console.log(`✅ Уведомление отправлено на ${notifyEmail}, id: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки письма:', error);
        return false;
    }
}

// Отправка уведомления об изменении статуса (заведующей)
async function sendStatusChangeNotification(ticket, branchName, branchEmail, oldStatus, newStatus, adminComment) {
    const transporter = initTransporter();
    
    if (!branchEmail) {
        console.log(`❌ У филиала ${branchName} нет email для уведомлений`);
        return;
    }
    
    const statusMap = {
        'new': '🟡 Новая',
        'in_progress': '🔵 В работе',
        'completed': '🟢 Выполнена',
        'cancelled': '🔴 Отменена'
    };
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #34c759; color: white; padding: 15px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 10px 10px; }
                .status-change { font-size: 20px; text-align: center; margin: 20px 0; }
                .old-status { color: #999; text-decoration: line-through; }
                .new-status { font-weight: bold; color: #34c759; font-size: 24px; }
                .button { display: inline-block; padding: 10px 20px; background: #007aff; color: white; text-decoration: none; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>📋 Статус заявки #${ticket.id} изменён</h2>
                </div>
                <div class="content">
                    <div class="status-change">
                        <span class="old-status">${statusMap[oldStatus]}</span>
                        <span> → </span>
                        <span class="new-status">${statusMap[newStatus]}</span>
                    </div>
                    
                    <div><strong>🏢 Ваш филиал:</strong> ${branchName}</div>
                    <div><strong>📝 Проблема:</strong> ${ticket.problem.substring(0, 100)}...</div>
                    
                    ${adminComment ? `<div><strong>💬 Комментарий администратора:</strong><br>${adminComment}</div>` : ''}
                    
                    <div style="text-align: center; margin-top: 20px;">
                        <a href="${process.env.APP_URL || 'http://localhost:3000'}/user.html" class="button">📱 Открыть приложение</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        await transporter.sendMail({
            from: `"Система заявок" <${process.env.SMTP_USER}>`,
            to: branchEmail,
            subject: `📋 Заявка #${ticket.id} — статус изменён на ${statusMap[newStatus]}`,
            text: `Статус заявки #${ticket.id} изменён с ${statusMap[oldStatus]} на ${statusMap[newStatus]}`,
            html: html,
        });
        console.log(`✅ Уведомление об изменении статуса отправлено в ${branchName}`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки уведомления о статусе:', error);
        return false;
    }
}

module.exports = {
    sendNewTicketNotification,
    sendStatusChangeNotification
};