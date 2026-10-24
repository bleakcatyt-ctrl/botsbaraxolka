const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN || '8902220728:AAES9DngrpesTAMsdPOGh8dKiGr1sMIAJL8';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'YOUR_ADMIN_CHAT_ID_HERE';

const bot = new Telegraf(BOT_TOKEN);
const sessions = {};

const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('💰 Продать вещи / Оценить', 'sell_start')],
  [Markup.button.callback('🛠 Что мы выкупаем?', 'categories')],
  [Markup.button.callback('📍 Зона выезда и контакты', 'contacts')],
  [Markup.button.callback('ℹ️ Как мы работаем', 'how_it_works')]
]);

bot.start((ctx) => {
  const name = ctx.from.first_name || 'друг';
  sessions[ctx.from.id] = {};
  ctx.reply(
    `👋 Привет, ${name}!\n\n` +
    `🏠 Скупаем и вывозим ненужные вещи, мебель, технику и любой хлам в **Воскресенском районе** (Московская область).\n\n` +
    `⚡️ **Оцениваем по фото за 5 минут!** Деньги сразу на месте.\n` +
    `🧹 Помогаем быстро освободить гараж, дачу, квартиру или балкон.\n\n` +
    `Выберите нужный пункт меню ниже:`,
    mainMenuKeyboard
  );
});

bot.action('main_menu', (ctx) => {
  sessions[ctx.from.id] = {};
  ctx.editMessageText(`🏠 **Главное меню**\n\nВыберите интересующий раздел:`, mainMenuKeyboard);
});

bot.action('categories', (ctx) => {
  ctx.editMessageText(
    `🛠 **Что мы выкупаем и вывозим:**\n\n` +
    `• **Бытовая техника:** холодильники, стиральные машины, плиты, микроволновки.\n` +
    `• **Мебель:** советская и современная, шкафы, диваны, столы.\n` +
    `• **Инструменты и гаражный скарб:** электроинструмент, металлолом.\n` +
    `• **Антиквариат и СССР:** посуда, статуэтки, часы, книги.\n\n` +
    `🗑 Осуществляем вывоз хлама из квартир, дач и гаражей.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('💰 Оценить мои вещи', 'sell_start')],
      [Markup.button.callback('« Назад в меню', 'main_menu')]
    ])
  );
});

bot.action('how_it_works', (ctx) => {
  ctx.editMessageText(
    `ℹ️ **Как проходит сделка:**\n\n` +
    `1️⃣ Присылаете фото вещей и адрес.\n` +
    `2️⃣ Называем стоимость выкупа.\n` +
    `3️⃣ Договариваемся о времени, сами грузим и **платим сразу**.\n\n` +
    `Работаем по всему Воскресенскому району.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('💰 Подать заявку', 'sell_start')],
      [Markup.button.callback('« Назад в меню', 'main_menu')]
    ])
  );
});

bot.action('contacts', (ctx) => {
  ctx.editMessageText(
    `📍 **Контакты:**\n\n` +
    `🏙 Воскресенский район, МО.\n` +
    `📞 Телефон / Telegram: +7 (999) 000-00-00\n` +
    `⏰ Ежедневно с 8:00 до 21:00.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('« Назад в меню', 'main_menu')]
    ])
  );
});

bot.action('sell_start', (ctx) => {
  sessions[ctx.from.id] = { step: 'waiting_photos', photos: [] };
  ctx.editMessageText(
    `📸 **Шаг 1 из 3: Фотографии**\n\n` +
    `Отправьте **фото** вещей (до 5 штук).\nКогда закончите, нажмите кнопку **«Готово»**.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отмена', 'main_menu')]
    ])
  );
});

bot.on('photo', (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];

  if (session && session.step === 'waiting_photos') {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    session.photos.push(photoId);

    if (session.photos.length === 1) {
      ctx.reply(
        `✅ Фото принято! Можете отправить еще или нажать кнопку:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Готово, к адресу', 'step_location')],
          [Markup.button.callback('❌ Отмена', 'main_menu')]
        ])
      );
    } else if (session.photos.length >= 5) {
      session.step = 'waiting_location';
      ctx.reply(`📍 **Шаг 2 из 3: Населенный пункт / Адрес**\n\nУкажите ваш населенный пункт в Воскресенском районе:`);
    }
  }
});

bot.action('step_location', (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session || session.photos.length === 0) return ctx.reply('Сначала отправьте фото!');

  session.step = 'waiting_location';
  ctx.editMessageText(
    `📍 **Шаг 2 из 3: Адрес**\n\nУкажите ваш населенный пункт в Воскресенском районе:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отмена', 'main_menu')]
    ])
  );
});

bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session || !session.step) return;

  if (session.step === 'waiting_location') {
    session.location = ctx.message.text;
    session.step = 'waiting_description';
    ctx.reply(`📝 **Шаг 3 из 3: Описание**\n\nОпишите состояние вещей, этаж, нужен ли вынос:`);
  } else if (session.step === 'waiting_description') {
    session.description = ctx.message.text;
    session.step = 'completed';

    const username = ctx.from.username ? `@${ctx.from.username}` : 'нет юзернейма';
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    ctx.reply(`🎉 **Заявка принята!**\n\nМы свяжемся с вами в ближайшее время.`, mainMenuKeyboard);

    const adminMsg = `🔥 **Новая заявка!**\n\n👤 Клиент: ${fullName} (${username})\n📍 Адрес: ${session.location}\n📝 Описание: ${session.description}`;

    if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'YOUR_ADMIN_CHAT_ID_HERE') {
      if (session.photos.length > 0) {
        const media = session.photos.map((id, i) => ({ type: 'photo', media: id, caption: i === 0 ? adminMsg : '' }));
        bot.telegram.sendMediaGroup(ADMIN_CHAT_ID, media).catch(console.error);
      } else {
        bot.telegram.sendMessage(ADMIN_CHAT_ID, adminMsg).catch(console.error);
      }
    }
    delete sessions[userId];
  }
});

bot.launch().then(() => console.log('Bot started successfully!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
