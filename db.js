// ─── IndexedDB wrapper ────────────────────────────────────────────────────────
const DB_NAME = 'migry_db', DB_VER = 2;
let _db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('attacks')) {
        const s = db.createObjectStore('attacks', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('checkins')) {
        const s = db.createObjectStore('checkins', { keyPath: 'date' }); // date = YYYY-MM-DD
      }
    };
    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror  = e => rej(e.target.error);
  });
}

function tx(store, mode = 'readonly') { return _db.transaction(store, mode).objectStore(store); }

function dbAdd(store, obj)    { return new Promise((r,j)=>{ const q=tx(store,'readwrite').add(obj); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }
function dbPut(store, obj)    { return new Promise((r,j)=>{ const q=tx(store,'readwrite').put(obj); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }
function dbGetAll(store)      { return new Promise((r,j)=>{ const q=tx(store).getAll(); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }
function dbDelete(store, key) { return new Promise((r,j)=>{ const q=tx(store,'readwrite').delete(key); q.onsuccess=()=>r(); q.onerror=()=>j(q.error); }); }
function dbGet(store, key)    { return new Promise((r,j)=>{ const q=tx(store).get(key); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }

// High-level helpers
async function addAttack(attack)    { return dbAdd('attacks', { ...attack, createdAt: Date.now() }); }
async function getAllAttacks()       { return dbGetAll('attacks'); }
async function deleteAttack(id)     { return dbDelete('attacks', id); }
async function saveCheckin(c)       { return dbPut('checkins', c); }
async function getCheckin(date)     { return dbGet('checkins', date); }
async function getAllCheckins()      { return dbGetAll('checkins'); }