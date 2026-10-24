const path = require('path');
const fs = require('fs');

const jsonDbPath = path.resolve(__dirname, 'database.json');

function readJsonDb() {
  if (!fs.existsSync(jsonDbPath)) {
    fs.writeFileSync(jsonDbPath, JSON.stringify({ users: [], lots: [], purchases: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
  } catch (e) {
    return { users: [], lots: [], purchases: [] };
  }
}

function writeJsonDb(data) {
  fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2));
}

const dbRun = async (sql, params = []) => {
  const dbData = readJsonDb();
  
  if (sql.includes('INSERT INTO users')) {
    const existing = dbData.users.find(x => x.id === params[0]);
    if (!existing) {
      dbData.users.push({
        id: params[0],
        username: params[1],
        is_banned: 0,
        is_admin: params[2],
        is_subscribed: 0,
        sub_until: 0,
        created_at: params[3]
      });
    }
  } else if (sql.includes('UPDATE users')) {
    const targetId = params[params.length - 1];
    const u = dbData.users.find(x => x.id === targetId);
    if (u) {
      if (sql.includes('is_banned = 1')) u.is_banned = 1;
      if (sql.includes('is_banned = 0')) u.is_banned = 0;
      if (sql.includes('is_admin = 1')) u.is_admin = 1;
      if (sql.includes('is_subscribed = 1')) {
        u.is_subscribed = 1;
        u.sub_until = params[1];
      }
      if (sql.includes('is_subscribed = 0')) {
        u.is_subscribed = 0;
        u.sub_until = 0;
      }
      if (sql.includes('username = ?')) {
        u.username = params[0];
      }
    }
  } else if (sql.includes('INSERT INTO lots')) {
    const newId = dbData.lots.length > 0 ? dbData.lots[dbData.lots.length - 1].id + 1 : 1;
    dbData.lots.push({
      id: newId,
      seller_id: params[0],
      title: params[1],
      description: params[2],
      price: params[3],
      photo: params[4],
      district: params[5],
      is_premium: params[6],
      status: params[7],
      created_at: params[8]
    });
    writeJsonDb(dbData);
    return { lastID: newId };
  } else if (sql.includes('UPDATE lots')) {
    const targetId = params[params.length - 1];
    const lot = dbData.lots.find(x => x.id === targetId);
    if (lot) {
      if (sql.includes("status = 'approved'")) lot.status = 'approved';
      if (sql.includes("status = 'rejected'")) lot.status = 'rejected';
      if (sql.includes("status = 'sold'")) lot.status = 'sold';
    }
  } else if (sql.includes('DELETE FROM lots')) {
    const targetId = params[0];
    dbData.lots = dbData.lots.filter(x => x.id !== targetId);
  } else if (sql.includes('INSERT INTO purchases')) {
    const newId = dbData.purchases.length > 0 ? dbData.purchases[dbData.purchases.length - 1].id + 1 : 1;
    dbData.purchases.push({
      id: newId,
      lot_id: params[0],
      buyer_id: params[1],
      seller_id: params[2],
      created_at: params[3]
    });
    writeJsonDb(dbData);
    return { lastID: newId };
  }

  writeJsonDb(dbData);
  return { lastID: 1 };
};

const dbGet = async (sql, params = []) => {
  const dbData = readJsonDb();
  if (sql.includes('FROM users WHERE id =')) {
    return dbData.users.find(x => x.id === params[0]) || null;
  } else if (sql.includes('FROM users WHERE username =')) {
    return dbData.users.find(x => x.username === params[0]) || null;
  } else if (sql.includes('FROM lots WHERE id =')) {
    return dbData.lots.find(x => x.id === params[0]) || null;
  } else if (sql.includes('COUNT(*)')) {
    const count = dbData.lots.filter(x => x.status === 'approved').length;
    return { count };
  }
  return null;
};

const dbAll = async (sql, params = []) => {
  const dbData = readJsonDb();
  if (sql.includes('FROM lots WHERE status =')) {
    let items = dbData.lots.filter(x => x.status === 'approved');
    items.sort((a, b) => (b.is_premium || 0) - (a.is_premium || 0) || b.id - a.id);
    const limit = params[1] || items.length;
    const offset = params[2] || 0;
    return items.slice(offset, offset + limit);
  } else if (sql.includes('FROM lots WHERE seller_id =')) {
    return dbData.lots.filter(x => x.seller_id === params[0]);
  } else if (sql.includes('FROM lots WHERE status = \'pending\'')) {
    return dbData.lots.filter(x => x.status === 'pending');
  } else if (sql.includes('FROM users')) {
    return dbData.users.slice(0, 20);
  }
  return [];
};

async function initDb() {
  readJsonDb();
  console.log('База данных успешно инициализирована (JSON-хранилище).');
}

module.exports = {
  dbRun,
  dbGet,
  dbAll,
  initDb
};
