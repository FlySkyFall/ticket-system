const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dbPath = path.join(__dirname, 'database', 'tickets.db');
const db = new sqlite3.Database(dbPath);

console.log('📝 Добавление нового администратора\n');

rl.question('Логин: ', (login) => {
    rl.question('Имя (ФИО): ', (name) => {
        rl.question('Пароль: ', (password) => {
            const hash = bcrypt.hashSync(password, 10);
            
            db.run(`INSERT INTO branches (name, login, password_hash, is_admin) VALUES (?, ?, ?, 1)`,
                [name, login, hash], function(err) {
                if (err) {
                    console.error('❌ Ошибка:', err.message);
                    if (err.message.includes('UNIQUE')) {
                        console.log('   Логин уже существует, попробуйте другой');
                    }
                } else {
                    console.log(`\n✅ Администратор добавлен!`);
                    console.log(`   Логин: ${login}`);
                    console.log(`   Пароль: ${password}`);
                    console.log(`   Имя: ${name}`);
                }
                db.close();
                rl.close();
            });
        });
    });
});