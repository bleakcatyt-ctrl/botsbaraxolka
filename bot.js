require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { initDb, dbGet, dbRun, dbAll } = require('./db');
const { getMainKeyboard, getAdminKeyboard, getDistrictKeyboard, getBackKeyboard } = require('./keyboards');

const token = process.env.BOT_TOKEN;
const mainAdminUsername = (process.env.MAIN_ADMIN || '@xzxzxzxzcz123').replace('@', '').toLowerCase();
const contactAdmin = process.env.CONTACT_ADMIN || '@xzxzxzxzcz123';
const city = process.env.CITY || 'Воскресенск';
const region = process.env.REGION || 'Московская область';

const bot = new TelegramBot(token, { polling: true });

// Временное хранилище состояний пользователей (State Machine)
// userStates[userId] = { step: '...', data: { ... } }
const userStates = {};

// Инициализация БД при старте
initDb().then(() => {
  console.log('База данных успешно инициализирована.');
});

// Проверка и регистрация пользователя в БД
async function ensureUser(msgUser) {
  if (!msgUser) return;
  const userId = msgUser.id;
  const username = msgUser.username ? msgUser.username.toLowerCase() : '';
  
  let user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  const isAdmin = (username === mainAdminUsername) ? 1 : (user ? user.is_admin : 0);
  
  if (!user) {
    await dbRun(
      'INSERT INTO users (id, username, is_banned, is_admin, is_subscribed, sub_until, created_at) VALUES (?, ?, 0, ?, 0, 0, ?)',
      [userId, username, isAdmin, Date.now()]
    );
  } else {
    // Обновляем юзернейм и права главного админа если изменились
    if (username === mainAdminUsername && user.is_admin === 0) {
      await dbRun('UPDATE users SET is_admin = 1, username = ? WHERE id = ?', [username, userId]);
    } else if (user.username !== username) {
      await dbRun('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
    }
  }
}

// Проверка бана
async function checkBan(userId) {
  const user = await dbGet('SELECT is_banned FROM users WHERE id = ?', [userId]);
  return user && user.is_banned === 1;
}

// Проверка статуса подписки
async function checkSubscription(userId) {
  const user = await dbGet('SELECT is_subscribed, sub_until FROM users WHERE id = ?', [userId]);
  if (!user || user.is_subscribed !== 1) return false;
  if (user.sub_until === 0) return true; // бессрочно
  return user.sub_until > Date.now();
}

// Проверка прав администратора
async function isAdminUser(userId, username) {
  if (username && username.toLowerCase().replace('@', '') === mainAdminUsername) return true;
  const user = await dbGet('SELECT is_admin FROM users WHERE id = ?', [userId]);
  return user && user.is_admin === 1;
}

// Главный хендлер сообщений
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const text = msg.text ? msg.text.trim() : '';

    await ensureUser(msg.from);

    // Проверка бана
    if (await checkBan(userId)) {
      await bot.sendMessage(chatId, '🚫 Вы забанены в этом боте.');
      return;
    }

    const isSub = await checkSubscription(userId);
    const isAdmin = await isAdminUser(userId, username);

    // Обработка кнопки "⬅️ Назад" / сброс состояния
    if (text === '⬅️ Назад') {
      delete userStates[userId];
      await bot.sendMessage(
        chatId, 
        `👋 <b>Барахолка ${city}, ${region}</b>\nГлавное меню:`, 
        { 
          parse_mode: 'HTML', 
          reply_markup: getMainKeyboard(isAdmin, isSub) 
        }
      );
      return;
    }

    // Обработка команды /start
    if (text === '/start') {
      delete userStates[userId];
      await bot.sendMessage(
        chatId,
        `👋 <b>Барахолка ${city}, ${region}</b>\n\nДобро пожаловать! Выберите нужный раздел в меню ниже:`,
        {
          parse_mode: 'HTML',
          reply_markup: getMainKeyboard(isAdmin, isSub)
        }
      );
      return;
    }

    // State Machine для Продажи (добавление лота)
    const stateObj = userStates[userId];
    if (stateObj && stateObj.flow === 'sell') {
      await handleSellFlow(msg, chatId, userId, stateObj, isSub, isAdmin);
      return;
    }

    // State Machine для Админ-панели (баны, подписки, админы)
    if (stateObj && stateObj.flow === 'admin_action') {
      await handleAdminActionFlow(msg, chatId, userId, stateObj, isAdmin);
      return;
    }

    // Главное меню кнопки
    if (text === '🛒 Купить') {
      await showCatalog(chatId, 0);
      return;
    }

    if (text === '📦 Продать') {
      userStates[userId] = { flow: 'sell', step: 1, data: {} };
      await bot.sendMessage(
        chatId,
        `📦 <b>Размещение лота (Шаг 1/6)</b>\n\nВведите название товара (например: <i>Холодильник Stinol рабочий</i>):`,
        { parse_mode: 'HTML', reply_markup: getBackKeyboard() }
      );
      return;
    }

    if (text === '👤 Мои лоты') {
      await showMyLots(chatId, userId);
      return;
    }

    if (text === '💎 Подписка') {
      await bot.sendMessage(
        chatId,
        `💎 <b>Приватная подписка «Барахолка ${city}»</b>\n\n` +
        `Дает премиум-возможности:\n` +
        `⭐ Премиум-лот (показ в самом верху каталога со звездой)\n` +
        `📸 Публикация до 5 фото в одном лоте\n` +
        `🔔 Приоритетная модерация без очереди\n` +
        `🏷 Бейдж «Проверенный продавец»\n\n` +
        `Чтобы купить подписку, обратитесь в личные сообщения к администратору: <b>${contactAdmin}</b>`,
        { parse_mode: 'HTML', reply_markup: getMainKeyboard(isAdmin, isSub) }
      );
      return;
    }

    if (text === '⭐ Премиум-функции' && isSub) {
      await bot.sendMessage(
        chatId,
        `⭐ **Премиум-панель участника**\n\nУ вас активна премиум-подписка! Ваши новые лоты автоматически получают статус премиум и публикуются с приоритетом.`,
        { parse_mode: 'Markdown', reply_markup: getMainKeyboard(isAdmin, isSub) }
      );
      return;
    }

    if (text === '🛡 Админ-панель' && isAdmin) {
      await bot.sendMessage(
        chatId,
        `🛡 <b>Панель администратора</b>\n\nВыберите действие:`,
        { parse_mode: 'HTML', reply_markup: getAdminKeyboard() }
      );
      return;
    }

    // Обработка кнопок админ-панели
    if (isAdmin) {
      if (text === '📋 Лоты на модерации') {
        await showPendingLots(chatId);
        return;
      }
      if (text === '👥 Пользователи') {
        await showUsersList(chatId);
        return;
      }
      if (text === '🚫 Забанить') {
        userStates[userId] = { flow: 'admin_action', action: 'ban' };
        await bot.sendMessage(chatId, `Введите ID или @username пользователя для бана:`, { reply_markup: getBackKeyboard() });
        return;
      }
      if (text === '✅ Разбанить') {
        userStates[userId] = { flow: 'admin_action', action: 'unban' };
        await bot.sendMessage(chatId, `Введите ID или @username пользователя для разбана:`, { reply_markup: getBackKeyboard() });
        return;
      }
      if (text === '💎 Выдать подписку') {
        userStates[userId] = { flow: 'admin_action', action: 'sub_give' };
        await bot.sendMessage(chatId, `Введите ID или @username и количество дней (через пробел, например: <code>12345678 30</code> или бессрочно: <code>12345678 0</code>):`, { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
        return;
      }
      if (text === '❌ Снять подписку') {
        userStates[userId] = { flow: 'admin_action', action: 'sub_remove' };
        await bot.sendMessage(chatId, `Введите ID или @username пользователя для снятия подписки:`, { reply_markup: getBackKeyboard() });
        return;
      }
      if (text === '👤 Сделать админом' && username && username.toLowerCase() === mainAdminUsername) {
        userStates[userId] = { flow: 'admin_action', action: 'make_admin' };
        await bot.sendMessage(chatId, `Введите ID или @username пользователя, чтобы сделать админом:`, { reply_markup: getBackKeyboard() });
        return;
      }
    }

  } catch (err) {
    console.error('Ошибка в хендлере сообщений:', err);
  }
});

// Логика пошагового создания лота
async function handleSellFlow(msg, chatId, userId, stateObj, isSub, isAdmin) {
  const text = msg.text ? msg.text.trim() : '';

  if (stateObj.step === 1) {
    if (!text) {
      await bot.sendMessage(chatId, 'Пожалуйста, введите корректное название товара:');
      return;
    }
    stateObj.data.title = text;
    stateObj.step = 2;
    await bot.sendMessage(chatId, `📦 <b>Размещение лота (Шаг 2/6)</b>\n\nВведите подробное описание товара:`, { parse_mode: 'HTML' });
    return;
  }

  if (stateObj.step === 2) {
    if (!text) {
      await bot.sendMessage(chatId, 'Пожалуйста, введите описание товара:');
      return;
    }
    stateObj.data.description = text;
    stateObj.step = 3;
    await bot.sendMessage(chatId, `📦 <b>Размещение лота (Шаг 3/6)</b>\n\nВведите цену товара в рублях (например: <i>1500 или 1500 руб</i>):`, { parse_mode: 'HTML' });
    return;
  }

  if (stateObj.step === 3) {
    if (!text) {
      await bot.sendMessage(chatId, 'Пожалуйста, укажите цену:');
      return;
    }
    stateObj.data.price = text;
    stateObj.step = 4;
    await bot.sendMessage(
      chatId, 
      `📦 <b>Размещение лота (Шаг 4/6)</b>\n\nВыберите район или место в <b>${city}</b> (или введите свой вариант текстом):`, 
      { parse_mode: 'HTML', reply_markup: getDistrictKeyboard() }
    );
    return;
  }

  if (stateObj.step === 4) {
    if (!text) {
      await bot.sendMessage(chatId, 'Выберите район кнопкой или введите текстом:');
      return;
    }
    stateObj.data.district = text;
    stateObj.step = 5;
    
    const photoPrompt = isSub 
      ? `📦 <b>Размещение лота (Шаг 5/6)</b>\n\n💎 У вас активна подписка! Вы можете отправить до 5 фото.\nОтправьте первое фото:` 
      : `📦 <b>Размещение лота (Шаг 5/6)</b>\n\nОтправьте <b>фотографию</b> товара:`;

    await bot.sendMessage(chatId, photoPrompt, { parse_mode: 'HTML', reply_markup: getBackKeyboard() });
    return;
  }

  if (stateObj.step === 5) {
    if (!msg.photo || msg.photo.length === 0) {
      await bot.sendMessage(chatId, 'Пожалуйста, отправьте фотографию товара в виде картинки.');
      return;
    }
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    stateObj.data.photo = photoId;
    stateObj.step = 6;

    // Подтверждение
    const { title, description, price, district } = stateObj.data;
    await bot.sendMessage(
      chatId,
      `📦 <b>Проверьте данные вашего лота (Шаг 6/6):</b>\n\n` +
      `📌 <b>Название:</b> ${title}\n` +
      `📝 <b>Описание:</b> ${description}\n` +
      `💰 <b>Цена:</b> ${price}\n` +
      `📍 <b>Район:</b> ${district}, ${city}, ${region}\n\n` +
      `Всё верно? Нажмите кнопку ниже для отправки на модерацию.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подтвердить и отправить', callback_data: 'confirm_lot' }],
            [{ text: '❌ Отменить', callback_data: 'cancel_lot' }]
          ]
        }
      }
    );
    return;
  }
}

// Логика админ-панели ввода данных (бан, подписки)
async function handleAdminActionFlow(msg, chatId, userId, stateObj, isAdmin) {
  if (!isAdmin) {
    delete userStates[userId];
    return;
  }
  const text = msg.text ? msg.text.trim() : '';

  let targetUser = null;
  if (text.startsWith('@')) {
    targetUser = await dbGet('SELECT * FROM users WHERE username = ?', [text.replace('@', '').toLowerCase()]);
  } else if (!isNaN(text)) {
    targetUser = await dbGet('SELECT * FROM users WHERE id = ?', [parseInt(text)]);
  }

  const action = stateObj.action;
  delete userStates[userId];

  if (action === 'ban') {
    if (!targetUser) {
      await bot.sendMessage(chatId, '❌ Пользователь не найден в базе данных.');
      return;
    }
    await dbRun('UPDATE users SET is_banned = 1 WHERE id = ?', [targetUser.id]);
    await bot.sendMessage(chatId, `🚫 Пользователь <code>${targetUser.id}</code> (@${targetUser.username || 'нет'}) забанен.`, { parse_mode: 'HTML' });
    return;
  }

  if (action === 'unban') {
    if (!targetUser) {
      await bot.sendMessage(chatId, '❌ Пользователь не найден.');
      return;
    }
    await dbRun('UPDATE users SET is_banned = 0 WHERE id = ?', [targetUser.id]);
    await bot.sendMessage(chatId, `✅ Пользователь <code>${targetUser.id}</code> разбанен.`, { parse_mode: 'HTML' });
    return;
  }

  if (action === 'sub_give') {
    const parts = text.split(/\s+/);
    let queryTarget = parts[0];
    let days = parseInt(parts[1]);

    let subUser = null;
    if (queryTarget.startsWith('@')) {
      subUser = await dbGet('SELECT * FROM users WHERE username = ?', [queryTarget.replace('@', '').toLowerCase()]);
    } else if (!isNaN(queryTarget)) {
      subUser = await dbGet('SELECT * FROM users WHERE id = ?', [parseInt(queryTarget)]);
    }

    if (!subUser || isNaN(days)) {
      await bot.sendMessage(chatId, '❌ Неверный формат. Пример: <code>12345678 30</code> или <code>@username 0</code>', { parse_mode: 'HTML' });
      return;
    }

    let subUntil = days === 0 ? 0 : Date.now() + (days * 24 * 60 * 60 * 1000);
    await dbRun('UPDATE users SET is_subscribed = 1, sub_until = ? WHERE id = ?', [subUntil, subUser.id]);
    await bot.sendMessage(chatId, `💎 Подписка успешно выдана пользователю <code>${subUser.id}</code> на ${days === 0 ? 'бессрочно' : days + ' дней'}.`, { parse_mode: 'HTML' });
    
    // Уведомление пользователю
    bot.sendMessage(subUser.id, `💎 Вам выдана премиум-подписка в боте «Барахолка ${city}»! Наслаждайтесь премиум-функциями.`).catch(() => {});
    return;
  }

  if (action === 'sub_remove') {
    if (!targetUser) {
      await bot.sendMessage(chatId, '❌ Пользователь не найден.');
      return;
    }
    await dbRun('UPDATE users SET is_subscribed = 0, sub_until = 0 WHERE id = ?', [targetUser.id]);
    await bot.sendMessage(chatId, `❌ Подписка снята у пользователя <code>${targetUser.id}</code>.`, { parse_mode: 'HTML' });
    return;
  }

  if (action === 'make_admin') {
    if (!targetUser) {
      await bot.sendMessage(chatId, '❌ Пользователь не найден.');
      return;
    }
    await dbRun('UPDATE users SET is_admin = 1 WHERE id = ?', [targetUser.id]);
    await bot.sendMessage(chatId, `🛡 Пользователь <code>${targetUser.id}</code> назначен администратором.`, { parse_mode: 'HTML' });
    return;
  }
}

// Inline Callback Queries Handler
bot.on('callback_query', async (query) => {
  try {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    await ensureUser(query.from);

    if (await checkBan(userId)) {
      await bot.answerCallbackQuery(query.id, { text: '🚫 Вы забанены.', show_alert: true });
      return;
    }

    const isSub = await checkSubscription(userId);
    const isAdmin = await isAdminUser(userId, query.from.username);

    if (data === 'confirm_lot') {
      const state = userStates[userId];
      if (!state || !state.data) {
        await bot.answerCallbackQuery(query.id, { text: 'Сессия истекла. Начните заново.' });
        return;
      }

      const { title, description, price, district, photo } = state.data;
      const isPrem = isSub ? 1 : 0;

      const result = await dbRun(
        'INSERT INTO lots (seller_id, title, description, price, photo, district, is_premium, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, title, description, price, photo, district, isPrem, 'pending', Date.now()]
      );

      const lotId = result.lastID;
      delete userStates[userId];

      await bot.editMessageText(
        `✅ <b>Лот успешно отправлен на модерацию!</b>\nПосле проверки администратором он появится в каталоге.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
      );

      // Уведомление админам
      const admins = await dbAll('SELECT id FROM users WHERE is_admin = 1');
      const sellerName = query.from.username ? `@${query.from.username}` : `ID: ${userId}`;

      for (const adm of admins) {
        bot.sendPhoto(adm.id, photo, {
          caption: `📋 <b>Новый лот на модерации! (ID: ${lotId})</b>\n\n` +
                   `👤 <b>Продавец:</b> ${sellerName}\n` +
                   `📌 <b>Название:</b> ${title}\n` +
                   `📝 <b>Описание:</b> ${description}\n` +
                   `💰 <b>Цена:</b> ${price}\n` +
                   `📍 <b>Район:</b> ${district}, ${city}\n` +
                   `⭐ <b>Премиум:</b> ${isPrem ? 'Да' : 'Нет'}`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Одобрить', callback_data: `approve_${lotId}` },
                { text: '❌ Отклонить', callback_data: `reject_${lotId}` }
              ],
              [
                { text: '🗑 Удалить', callback_data: `delete_${lotId}` }
              ]
            ]
          }
        }).catch(() => {});
      }

      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'cancel_lot') {
      delete userStates[userId];
      await bot.editMessageText('❌ Создание лота отменено.', { chat_id: chatId, message_id: messageId });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Пагинация каталога: catalog_page_X
    if (data.startsWith('catalog_page_')) {
      const page = parseInt(data.replace('catalog_page_', '')) || 0;
      await showCatalog(chatId, page, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Покупка лота: buy_lot_ID
    if (data.startsWith('buy_lot_')) {
      const lotId = parseInt(data.replace('buy_lot_', ''));
      const lot = await dbGet('SELECT * FROM lots WHERE id = ? AND status = ?', [lotId, 'approved']);
      
      if (!lot) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Лот уже продан или недоступен.', show_alert: true });
        return;
      }

      if (lot.seller_id === userId) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Вы не можете купить собственный лот.', show_alert: true });
        return;
      }

      // Меняем статус на sold
      await dbRun('UPDATE lots SET status = ? WHERE id = ?', ['sold', lotId]);
      await dbRun('INSERT INTO purchases (lot_id, buyer_id, seller_id, created_at) VALUES (?, ?, ?, ?)', [lotId, userId, lot.seller_id, Date.now()]);

      const seller = await dbGet('SELECT username FROM users WHERE id = ?', [lot.seller_id]);
      const buyer = await dbGet('SELECT username FROM users WHERE id = ?', [userId]);

      const sellerUsername = seller && seller.username ? `@${seller.username}` : `ID: ${lot.seller_id}`;
      const buyerUsername = buyer && buyer.username ? `@${buyer.username}` : `ID: ${userId}`;

      // Покупателю показываем контакты продавца
      await bot.editMessageCaption(
        `🎉 <b>Товар успешно куплен!</b>\n\n` +
        `📌 ${lot.title}\n💰 ${lot.price}\n\n` +
        `📞 <b>Свяжитесь с продавцом для получения товара:</b> ${sellerUsername}`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
      );

      // Продавцу уведомление
      bot.sendMessage(
        lot.seller_id,
        `💸 <b>Ваш товар купили!</b>\n\n` +
        `📌 <b>Лот:</b> ${lot.title}\n` +
        `💰 <b>Цена:</b> ${lot.price}\n` +
        `👤 <b>Покупатель:</b> ${buyerUsername}\n\n` +
        `Свяжитесь с покупателем для передачи товара.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await bot.answerCallbackQuery(query.id, { text: 'Поздравляем с покупкой!', show_alert: true });
      return;
    }

    // Удаление своего лота: my_delete_ID
    if (data.startsWith('my_delete_')) {
      const lotId = parseInt(data.replace('my_delete_', ''));
      const lot = await dbGet('SELECT * FROM lots WHERE id = ? AND seller_id = ?', [lotId, userId]);

      if (!lot) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Лот не найден.', show_alert: true });
        return;
      }

      await dbRun('DELETE FROM lots WHERE id = ?', [lotId]);
      await bot.answerCallbackQuery(query.id, { text: '🗑 Лот удален.' });
      await showMyLots(chatId, userId, messageId);
      return;
    }

    // Модерация админом: approve_ID, reject_ID, delete_ID
    if (isAdmin) {
      if (data.startsWith('approve_')) {
        const lotId = parseInt(data.replace('approve_', ''));
        await dbRun('UPDATE lots SET status = ? WHERE id = ?', ['approved', lotId]);
        
        const lot = await dbGet('SELECT * FROM lots WHERE id = ?', [lotId]);
        if (lot) {
          bot.sendMessage(lot.seller_id, `✅ <b>Ваш лот «${lot.title}» успешно одобрен модератором и опубликован в каталоге!</b>`, { parse_mode: 'HTML' }).catch(() => {});
        }

        await bot.answerCallbackQuery(query.id, { text: 'Лот одобрен и опубликован!' });
        await bot.editMessageCaption(`✅ <b>Лот одобрен администратором</b>`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      if (data.startsWith('reject_')) {
        const lotId = parseInt(data.replace('reject_', ''));
        await dbRun('UPDATE lots SET status = ? WHERE id = ?', ['rejected', lotId]);

        const lot = await dbGet('SELECT * FROM lots WHERE id = ?', [lotId]);
        if (lot) {
          bot.sendMessage(lot.seller_id, `❌ <b>Ваш лот «${lot.title}» был отклонен модератором.</b>`, { parse_mode: 'HTML' }).catch(() => {});
        }

        await bot.answerCallbackQuery(query.id, { text: 'Лот отклонен.' });
        await bot.editMessageCaption(`❌ <b>Лот отклонен администратором</b>`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      if (data.startsWith('delete_')) {
        const lotId = parseInt(data.replace('delete_', ''));
        await dbRun('DELETE FROM lots WHERE id = ?', [lotId]);

        await bot.answerCallbackQuery(query.id, { text: 'Лот удален из базы.' });
        await bot.editMessageCaption(`🗑 <b>Лот удален администратором</b>`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
        return;
      }
    }

  } catch (err) {
    console.error('Ошибка в callback_query:', err);
  }
});

// Функция показа каталога с пагинацией
async function showCatalog(chatId, page = 0, messageId = null) {
  const limit = 5;
  const offset = page * limit;

  // Сначала премиум, потом обычные, статус approved
  const lots = await dbAll(
    'SELECT * FROM lots WHERE status = ? ORDER BY is_premium DESC, id DESC LIMIT ? OFFSET ?',
    ['approved', limit, offset]
  );

  const totalRow = await dbGet('SELECT COUNT(*) as count FROM lots WHERE status = ?', ['approved']);
  const total = totalRow ? totalRow.count : 0;

  if (lots.length === 0) {
    const text = '🛒 <b>Каталог товаров пуст</b>\n\nВ данный момент нет активных объявлений.';
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }
    return;
  }

  // Отправляем каждый лот отдельным сообщением с фото и кнопкой "Купить"
  for (const lot of lots) {
    const seller = await dbGet('SELECT username FROM users WHERE id = ?', [lot.seller_id]);
    const sellerName = seller && seller.username ? `@${seller.username}` : 'скрыт';
    const premBadge = lot.is_premium ? '⭐ <b>ПРЕМИУМ ЛОТ</b>\n' : '';

    const caption = 
      `${premBadge}` +
      `📌 <b>${lot.title}</b>\n\n` +
      `📝 ${lot.description}\n\n` +
      `💰 <b>Цена:</b> ${lot.price}\n` +
      `📍 <b>Район:</b> ${lot.district}, ${city}\n` +
      `👤 <b>Продавец:</b> ${sellerName}`;

    await bot.sendPhoto(chatId, lot.photo, {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💸 Купить', callback_data: `buy_lot_${lot.id}` }]
        ]
      }
    }).catch(() => {});
  }

  // Кнопки пагинации
  const paginationButtons = [];
  if (page > 0) {
    paginationButtons.push({ text: '◀️ Назад', callback_data: `catalog_page_${page - 1}` });
  }
  if ((offset + limit) < total) {
    paginationButtons.push({ text: 'Вперед ▶️', callback_data: `catalog_page_${page + 1}` });
  }

  const replyMarkup = paginationButtons.length > 0 ? { inline_keyboard: [paginationButtons] } : undefined;

  await bot.sendMessage(
    chatId,
    `📄 Страница каталога ${page + 1} из ${Math.ceil(total / limit) || 1}`,
    { reply_markup: replyMarkup }
  );
}

// Функция показа своих лотов
async function showMyLots(chatId, userId, messageId = null) {
  const lots = await dbAll('SELECT * FROM lots WHERE seller_id = ? ORDER BY id DESC', [userId]);

  if (lots.length === 0) {
    const text = '👤 У вас пока нет размещенных лотов.';
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text);
    }
    return;
  }

  for (const lot of lots) {
    let statusText = '';
    if (lot.status === 'pending') statusText = '⏳ На модерации';
    else if (lot.status === 'approved') statusText = '✅ Одобрен (активен)';
    else if (lot.status === 'rejected') statusText = '❌ Отклонён';
    else if (lot.status === 'sold') statusText = '💸 Продан';

    const caption = 
      `📌 <b>${lot.title}</b>\n` +
      `💰 ${lot.price} | 📍 ${lot.district}\n` +
      `📊 <b>Статус:</b> ${statusText}`;

    await bot.sendPhoto(chatId, lot.photo, {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑 Удалить лот', callback_data: `my_delete_${lot.id}` }]
        ]
      }
    }).catch(() => {});
  }
}

// Модерация: очередь лотов
async function showPendingLots(chatId) {
  const lots = await dbAll('SELECT * FROM lots WHERE status = ? ORDER BY id ASC', ['pending']);

  if (lots.length === 0) {
    await bot.sendMessage(chatId, '📋 Нет лотов, ожидающих модерации.');
    return;
  }

  for (const lot of lots) {
    const seller = await dbGet('SELECT username FROM users WHERE id = ?', [lot.seller_id]);
    const sellerName = seller && seller.username ? `@${seller.username}` : `ID: ${lot.seller_id}`;

    await bot.sendPhoto(chatId, lot.photo, {
      caption: `📋 <b>Лот на модерации (ID: ${lot.id})</b>\n\n` +
               `👤 Продавец: ${sellerName}\n` +
               `📌 Название: ${lot.title}\n` +
               `📝 Описание: ${lot.description}\n` +
               `💰 Цена: ${lot.price}\n` +
               `📍 Район: ${lot.district}, ${city}`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Одобрить', callback_data: `approve_${lot.id}` },
            { text: '❌ Отклонить', callback_data: `reject_${lot.id}` }
          ],
          [
            { text: '🗑 Удалить', callback_data: `delete_${lot.id}` }
          ]
        ]
      }
    }).catch(() => {});
  }
}

// Список пользователей в админке
async function showUsersList(chatId) {
  const users = await dbAll('SELECT * FROM users ORDER BY created_at DESC LIMIT 20');
  if (users.length === 0) {
    await bot.sendMessage(chatId, '👥 Пользователей пока нет.');
    return;
  }

  let msgText = '👥 <b>Последние пользователи (до 20):</b>\n\n';
  for (const u of users) {
    const uname = u.username ? `@${u.username}` : 'нет';
    const subStatus = u.is_subscribed ? '💎 Подписка' : '👤 Обычный';
    const banStatus = u.is_banned ? '🚫 ЗАБАНЕН' : '🟢 Активен';
    const adminStatus = u.is_admin ? '🛡 Админ' : '';

    msgText += `• ID: <code>${u.id}</code> | ${uname}\n  Статус: ${banStatus} | ${subStatus} ${adminStatus}\n\n`;
  }

  await bot.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
}

console.log('Бот «Барахолка Воскресенск» запущен...');
