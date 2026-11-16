// TalentFlow HR CRM server. Zero dependencies, Node 18+.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const FILE = path.join(__dirname, 'data.json');
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_KEY || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('tf-' + (process.env.ADMIN_PASS || 'admin123')).digest('hex');
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const STAGES = ['Applied', 'Screened', 'Shortlisted', 'Interview', 'Selected', 'Rejected'];
const SRC = { link: 'Direct link', linkedin: 'LinkedIn', indeed: 'Indeed', rozee: 'Rozee.pk', social: 'Social media' };
let db = { jobs: [], apps: [], users: [], settings: { th: 60 } };

// ---------- storage (Supabase if configured, else local file) ----------
const H = () => SB_KEY.startsWith('sb_') ? { apikey: SB_KEY, 'Content-Type': 'application/json' } : { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
async function load() {
  if (SB_URL) {
    const r = await fetch(`${SB_URL}/rest/v1/kv?key=eq.db&select=value`, { headers: H() });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j)) throw new Error('Supabase load failed: ' + JSON.stringify(j));
    if (j[0]) db = j[0].value;
  } else if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
let timer;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
async function flush() {
  try {
    if (SB_URL) {
      const r = await fetch(`${SB_URL}/rest/v1/kv?on_conflict=key`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key: 'db', value: db }) });
      if (!r.ok) console.error('Save failed', r.status, await r.text());
    } else fs.writeFileSync(FILE, JSON.stringify(db));
  } catch (e) { console.error('Save error', e.message); }
}
process.on('SIGTERM', async () => { await flush(); process.exit(0); });

// ---------- helpers ----------
const rid = () => crypto.randomBytes(6).toString('hex');
const today = () => new Date().toISOString().slice(0, 10);
const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 32).toString('hex');
const check = (p, h) => { const [s, x] = String(h).split(':'); const y = hash(p, s).split(':')[1]; return x && x.length === y.length && crypto.timingSafeEqual(Buffer.from(x, 'hex'), Buffer.from(y, 'hex')); };
const sign = v => { const b = Buffer.from(JSON.stringify(v)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const unsign = t => { try { const [b, s] = String(t).split('.'); if (crypto.createHmac('sha256', SECRET).update(b).digest('base64url') !== s) return null; const v = JSON.parse(Buffer.from(b, 'base64url').toString()); return v.exp > Date.now() ? v : null; } catch { return null; } };
const cookies = h => Object.fromEntries((h || '').split(';').map(s => s.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, v.join('=')]));
const send = (res, c, o, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(o)); };
const fail = (res, c, m) => send(res, c, { error: m });
const body = req => new Promise((ok, no) => { let s = ''; req.on('data', c => { s += c; if (s.length > 6e6) { no(new Error('Request too large')); req.destroy(); } }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { no(new Error('Bad request')); } }); });
const jobOf = i => db.jobs.find(j => j.id === i);
const pub = u => ({ id: u.id, username: u.username, name: u.name, role: u.role });
const hits = {};
const limited = (k, max, ms) => { const n = Date.now(); hits[k] = (hits[k] || []).filter(t => n - t < ms); if (hits[k].length >= max) return true; hits[k].push(n); return false; };

function score(a) {
  const j = jobOf(a.jobId) || { keywords: [], minExp: 0 };
  const t = ((a.text || '') + ' ' + a.name).toLowerCase();
  const m = j.keywords.filter(k => t.includes(k.toLowerCase()));
  const kp = j.keywords.length ? m.length / j.keywords.length : 0;
  const ep = j.minExp ? Math.min(a.exp / j.minExp, 1) : 1;
  return { score: Math.round(kp * 70 + ep * 30), matched: m };
}
function mkApp(o, by, label) {
  const a = { id: rid(), jobId: o.jobId, name: String(o.name).trim().slice(0, 120), email: String(o.email).trim().slice(0, 160), phone: String(o.phone || '').slice(0, 40), exp: Math.max(0, Math.min(60, parseFloat(o.exp) || 0)), text: String(o.text || '').slice(0, 8000), source: o.source, date: today(), stage: 'Applied', score: null, matched: [], notes: '', log: [{ t: Date.now(), by, x: label }] };
  db.apps.push(a); return a;
}
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());

// ---------- API ----------
async function api(req, res, u, p) {
  const m = req.method, ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const b = ['POST', 'PUT', 'PATCH'].includes(m) ? await body(req) : {};
  let r;
  if (p === '/api/health') return send(res, 200, { ok: true });

  // public: job info + apply
  if ((r = p.match(/^\/api\/public\/job\/(\w+)$/)) && m === 'GET') {
    const j = jobOf(r[1]); if (!j) return fail(res, 404, 'Job not found');
    return send(res, 200, { id: j.id, title: j.title, dept: j.dept, sector: j.sector, keywords: j.keywords, minExp: j.minExp, status: j.status });
  }
  if (p === '/api/public/apply' && m === 'POST') {
    if (b.website) return send(res, 200, { ok: true });           // honeypot
    if (limited('apply' + ip, 15, 3600e3)) return fail(res, 429, 'Too many applications. Try again later.');
    const j = jobOf(b.jobId);
    if (!j || j.status !== 'Open') return fail(res, 400, 'This position is closed.');
    if (!String(b.name || '').trim() || !validEmail(b.email)) return fail(res, 400, 'Please enter a valid name and email.');
    if (db.apps.some(a => a.jobId === j.id && a.email.toLowerCase() === String(b.email).trim().toLowerCase())) return fail(res, 409, 'You have already applied for this job.');
    const src = SRC[b.source] || 'Direct link';
    mkApp({ ...b, jobId: j.id, source: src }, String(b.name).slice(0, 60), 'Applied via ' + src); save();
    return send(res, 200, { ok: true });
  }

  // auth
  if (p === '/api/login' && m === 'POST') {
    if (limited('login' + ip, 10, 900e3)) return fail(res, 429, 'Too many attempts. Wait 15 minutes.');
    const us = db.users.find(x => x.username === String(b.username || '').trim().toLowerCase());
    if (!us || !check(String(b.password || ''), us.pw)) return fail(res, 401, 'Wrong username or password.');
    const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { user: pub(us) }, { 'Set-Cookie': `tf=${sign({ u: us.id, exp: Date.now() + 7 * 864e5 })}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${sec}` });
  }
  if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'tf=; HttpOnly; Path=/; Max-Age=0' });

  const sess = unsign(cookies(req.headers.cookie).tf);
  const me = sess && db.users.find(x => x.id === sess.u);
  if (!me) return fail(res, 401, 'Please sign in.');
  const HR = ['admin', 'hr'].includes(me.role), ADMIN = me.role === 'admin';
  if (p === '/api/me') return send(res, 200, { user: pub(me) });
  if (p === '/api/data') return send(res, 200, { user: pub(me), jobs: db.jobs, apps: db.apps, th: db.settings.th, users: ADMIN ? db.users.map(pub) : [] });
  if (p === '/api/password' && m === 'POST') {
    if (!check(String(b.old || ''), me.pw)) return fail(res, 400, 'Current password is wrong.');
    if (String(b.new || '').length < 6) return fail(res, 400, 'New password must be at least 6 characters.');
    me.pw = hash(b.new); save(); return send(res, 200, { ok: true });
  }

  // manager + HR: update stage / notes
  if ((r = p.match(/^\/api\/apps\/(\w+)$/)) && r[1] !== 'import') {
    const a = db.apps.find(x => x.id === r[1]); if (!a) return fail(res, 404, 'Candidate not found');
    if (m === 'PATCH') {
      if (typeof b.notes === 'string') a.notes = b.notes.slice(0, 2000);
      if (b.stage) {
        if (!STAGES.includes(b.stage)) return fail(res, 400, 'Bad stage');
        if (!HR && (a.stage === 'Applied' || b.stage === 'Applied' || b.stage === 'Screened')) return fail(res, 403, 'Only HR can do that.');
        a.stage = b.stage; a.log.push({ t: Date.now(), by: me.name, x: 'Moved to ' + b.stage });
      }
      save(); return send(res, 200, { ok: true });
    }
    if (m === 'DELETE') { if (!HR) return fail(res, 403, 'HR only'); db.apps = db.apps.filter(x => x !== a); save(); return send(res, 200, { ok: true }); }
  }

  // HR only below
  if (!HR && p !== '/api/users') return fail(res, 403, 'HR access required.');
  if (p === '/api/jobs' && m === 'POST') {
    if (!String(b.title || '').trim() || !String(b.dept || '').trim()) return fail(res, 400, 'Title and department are required.');
    db.jobs.push({ id: rid(), title: b.title.trim().slice(0, 100), dept: b.dept.trim().slice(0, 80), sector: String(b.sector || '').slice(0, 60), keywords: (b.keywords || []).map(k => String(k).trim()).filter(Boolean).slice(0, 40), minExp: Math.max(0, +b.minExp || 0), status: 'Open' });
    save(); return send(res, 200, { ok: true });
  }
  if ((r = p.match(/^\/api\/jobs\/(\w+)$/))) {
    const j = jobOf(r[1]); if (!j) return fail(res, 404, 'Job not found');
    if (m === 'PATCH') { if (b.status) j.status = b.status === 'Closed' ? 'Closed' : 'Open'; save(); return send(res, 200, { ok: true }); }
    if (m === 'DELETE') { db.jobs = db.jobs.filter(x => x !== j); save(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/ats/run' && m === 'POST') {
    let n = 0;
    for (const a of db.apps.filter(x => x.stage === 'Applied')) {
      const s = score(a); a.score = s.score; a.matched = s.matched;
      a.stage = s.score >= db.settings.th ? 'Screened' : 'Rejected';
      a.log.push({ t: Date.now(), by: 'ATS', x: `Scored ${s.score}% → ${a.stage}` }); n++;
    }
    save(); return send(res, 200, { count: n });
  }
  if (p === '/api/settings' && m === 'PUT') { db.settings.th = Math.max(0, Math.min(100, +b.th || 0)); save(); return send(res, 200, { ok: true }); }
  if (p === '/api/apps/import' && m === 'POST') {
    const j = jobOf(b.jobId); if (!j) return fail(res, 400, 'Choose a job first.');
    const src = String(b.source || 'Other').slice(0, 40); let ok = 0, dup = 0, bad = 0;
    const have = new Set(db.apps.filter(a => a.jobId === j.id).map(a => a.email.toLowerCase()));
    for (const row of (b.rows || []).slice(0, 5000)) {
      if (!String(row.name || '').trim() || !validEmail(row.email)) { bad++; continue; }
      const k = String(row.email).trim().toLowerCase(); if (have.has(k)) { dup++; continue; } have.add(k);
      mkApp({ ...row, jobId: j.id, source: src }, me.name, 'Imported from ' + src); ok++;
    }
    save(); return send(res, 200, { ok, dup, bad });
  }

  // admin: users
  if (p === '/api/users') { if (!ADMIN) return fail(res, 403, 'Admin only'); }
  if (p === '/api/users' && m === 'POST') {
    const un = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(un)) return fail(res, 400, 'Username: 3-30 letters/numbers.');
    if (String(b.password || '').length < 6) return fail(res, 400, 'Password must be at least 6 characters.');
    if (db.users.some(x => x.username === un)) return fail(res, 409, 'That username is taken.');
    db.users.push({ id: rid(), username: un, name: String(b.name || un).slice(0, 60), role: ['admin', 'hr', 'manager'].includes(b.role) ? b.role : 'manager', pw: hash(b.password) });
    save(); return send(res, 200, { ok: true });
  }
  if ((r = p.match(/^\/api\/users\/(\w+)$/))) {
    if (!ADMIN) return fail(res, 403, 'Admin only');
    const x = db.users.find(y => y.id === r[1]); if (!x) return fail(res, 404, 'User not found');
    if (m === 'PATCH') {
      if (b.role && x.id !== me.id) x.role = ['admin', 'hr', 'manager'].includes(b.role) ? b.role : x.role;
      if (b.password) { if (String(b.password).length < 6) return fail(res, 400, 'Password must be at least 6 characters.'); x.pw = hash(b.password); }
      save(); return send(res, 200, { ok: true });
    }
    if (m === 'DELETE') { if (x.id === me.id) return fail(res, 400, 'You cannot delete yourself.'); db.users = db.users.filter(y => y !== x); save(); return send(res, 200, { ok: true }); }
  }
  return fail(res, 404, 'Not found');
}

// ---------- first-run seed ----------
function seed() {
  if (!db.users.length) {
    db.users.push({ id: rid(), username: (process.env.ADMIN_USER || 'admin').toLowerCase(), name: 'HR Admin', role: 'admin', pw: hash(process.env.ADMIN_PASS || 'admin123') });
    console.log('Created admin user. Username:', db.users[0].username);
  }
  if (!db.jobs.length && process.env.SEED_DEMO !== '0') {
    const J = [['HR Executive', 'Human Resources', 'Corporate', ['recruitment', 'payroll', 'onboarding', 'communication', 'excel'], 2], ['Staff Nurse', 'Nursing', 'Healthcare', ['patient care', 'iv', 'bls', 'documentation', 'triage'], 1], ['Software Engineer', 'IT', 'Technology', ['javascript', 'react', 'sql', 'api', 'git'], 3], ['School Teacher', 'Academics', 'Education', ['lesson planning', 'classroom', 'curriculum', 'assessment'], 2]];
    J.forEach(([title, dept, sector, keywords, minExp]) => db.jobs.push({ id: rid(), title, dept, sector, keywords, minExp, status: 'Open' }));
    const D = [[0, 'Ayesha Khan', 3, 'Handled recruitment, onboarding and payroll for 3 years. Strong communication, advanced Excel.'], [0, 'Bilal Ahmed', 0, 'Fresh graduate in business administration.'], [2, 'Sara Malik', 4, 'Built web apps with JavaScript and React, REST API design, SQL databases, Git workflows.'], [1, 'Hina Rashid', 2, 'Staff nurse with BLS, IV therapy, triage and patient care documentation experience.']];
    D.forEach(([i, name, exp, text], k) => mkApp({ jobId: db.jobs[i].id, name, email: name.split(' ')[0].toLowerCase() + '@example.com', phone: '0300-000000' + k, exp, text, source: ['LinkedIn', 'Rozee.pk', 'Indeed', 'Direct link'][k] }, name, 'Applied (demo data)'));
  }
}

(async () => {
  try { await load(); } catch (e) { console.error(e.message); process.exit(1); }
  seed(); await flush();
  http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'), p = u.pathname;
      if (p.startsWith('/api/')) return await api(req, res, u, p);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(INDEX);
    } catch (e) { if (!res.headersSent) fail(res, 500, e.message || 'Server error'); else res.end(); }
  }).listen(PORT, () => console.log('TalentFlow running on port ' + PORT + (SB_URL ? ' (Supabase storage)' : ' (local file storage)')));
})();
