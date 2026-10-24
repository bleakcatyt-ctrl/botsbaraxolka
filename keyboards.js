const TelegramBot = require('node-telegram-bot-api');

// Функция создания клавиатур
function getMainKeyboard(isAdmin, isSubscribed) {
  const keyboard = [
    [{ text: '🛒 Купить' }, { text: '📦 Продать' }],
    [{ text: '👤 Мои лоты' }, { text: '💎 Подписка' }]
  ];
  if (isSubscribed) {
    keyboard.push([{ text: '⭐ Премиум-функции' }]);
  }
  if (isAdmin) {
    keyboard.push([{ text: '🛡 Админ-панель' }]);
  }
  return {
    keyboard: keyboard,
    resize_keyboard: true
  };
}

function getAdminKeyboard() {
  return {
    keyboard: [
      [{ text: '📋 Лоты на модерации' }, { text: '👥 Пользователи' }],
      [{ text: '🚫 Забанить' }, { text: '✅ Разбанить' }],
      [{ text: '💎 Выдать подписку' }, { text: '❌ Снять подписку' }],
      [{ text: '👤 Сделать админом' }, { text: '⬅️ Назад' }]
    ],
    resize_keyboard: true
  };
}

function getDistrictKeyboard() {
  return {
    keyboard: [
      [{ text: 'Центр' }, { text: 'Новлянское' }],
      [{ text: 'Белоозёрский' }, { text: 'Фосфоритный' }],
      [{ text: 'им. Цюрупы' }, { text: 'Хорлово' }],
      [{ text: 'Виноградово' }, { text: 'Лопатинский' }],
      [{ text: '⬅️ Назад' }]
    ],
    resize_keyboard: true
  };
}

function getBackKeyboard() {
  return {
    keyboard: [[{ text: '⬅️ Назад' }]],
    resize_keyboard: true
  };
}

module.exports = {
  getMainKeyboard,
  getAdminKeyboard,
  getDistrictKeyboard,
  getBackKeyboard
};
