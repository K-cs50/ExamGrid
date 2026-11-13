const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const db = mysql.createPool({
  host:        process.env.DB_HOST     || 'localhost',
  port:        parseInt(process.env.DB_PORT || '3306'),
  user:        process.env.DB_USER     || 'root',
  password:    process.env.DB_PASSWORD || '',
  database:    process.env.DB_NAME     || 'invigilator_db',
  ssl:         process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  dateStrings: true,
  connectTimeout: 10000,
});
const q = (sql, p) => db.query(sql, p).then(r => r[0]);
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const w = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.message }));

// Faculty allowed in this session, least duties first
const eligible = sid => q(`
  SELECT f.faculty_id, f.name, f.base_duties + COALESCE(d.c, 0) AS duties
  FROM faculty f
  LEFT JOIN (SELECT faculty_id, COUNT(*) c FROM allocation
             WHERE role='PRIMARY' AND status='ASSIGNED' GROUP BY faculty_id) d
         ON d.faculty_id = f.faculty_id
  WHERE f.dept_id <> (SELECT dept_id FROM exam_session WHERE session_id = ?)
    AND f.faculty_id NOT IN (SELECT faculty_id FROM unavailability WHERE session_id = ?)
    AND f.faculty_id NOT IN (SELECT faculty_id FROM allocation WHERE session_id = ?)
  ORDER BY duties ASC, f.name ASC`, [sid, sid, sid]);

app.get('/api/faculty', w(async (req, res) => res.json(await q('SELECT * FROM faculty ORDER BY name'))));

app.get('/api/sessions', w(async (req, res) => res.json(await q(`
  SELECT s.*, GROUP_CONCAT(h.hall_name ORDER BY h.hall_name) AS halls,
         (SELECT COUNT(*) FROM allocation a WHERE a.session_id = s.session_id) AS allocated
  FROM exam_session s
  JOIN session_hall sh ON sh.session_id = s.session_id
  JOIN hall h ON h.hall_id = sh.hall_id
  GROUP BY s.session_id ORDER BY s.exam_date, s.shift`))));

app.get('/api/session/:id', w(async (req, res) => {
  const id = req.params.id;
  const [session] = await q('SELECT * FROM exam_session WHERE session_id = ?', [id]);
  if (!session) throw fail('Session not found', 404);
  const halls = await q(`SELECT sh.session_hall_id, h.hall_name, sh.students_count students,
      sh.invigilators_needed needed FROM session_hall sh JOIN hall h ON h.hall_id = sh.hall_id
      WHERE sh.session_id = ? ORDER BY h.hall_name`, [id]);
  const al = await q(`SELECT a.alloc_id, a.session_hall_id, a.role, a.status, f.faculty_id, f.name, f.dept_id
      FROM allocation a JOIN faculty f ON f.faculty_id = a.faculty_id WHERE a.session_id = ?`, [id]);
  halls.forEach(h => h.people = al.filter(x => x.role === 'PRIMARY' && x.session_hall_id === h.session_hall_id));
  res.json({ session, halls, reserves: al.filter(x => x.role === 'RESERVE') });
}));

// Auto-allocate: fill every hall, then one reserve
app.post('/api/allocate/:id', w(async (req, res) => {
  const id = req.params.id;
  await q('DELETE FROM allocation WHERE session_id = ?', [id]);
  const pool = await eligible(id);
  const halls = await q('SELECT * FROM session_hall WHERE session_id = ?', [id]);
  const need = halls.reduce((n, h) => n + h.invigilators_needed, 0);
  if (pool.length < need) throw fail(`Not enough eligible faculty: need ${need}, have ${pool.length}.`);
  let k = 0;
  for (const h of halls)
    for (let i = 0; i < h.invigilators_needed; i++)
      await q('INSERT INTO allocation (session_id, session_hall_id, faculty_id) VALUES (?,?,?)',
              [id, h.session_hall_id, pool[k++].faculty_id]);
  if (pool[k])
    await q("INSERT INTO allocation (session_id, faculty_id, role) VALUES (?,?,'RESERVE')", [id, pool[k].faculty_id]);
  res.json({ ok: true });
}));

app.delete('/api/allocate/:id', w(async (req, res) => {
  await q('DELETE FROM allocation WHERE session_id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// Mark absent: reserve takes the hall, change is logged
app.post('/api/absent/:allocId', w(async (req, res) => {
  const [a] = await q('SELECT * FROM allocation WHERE alloc_id = ?', [req.params.allocId]);
  if (!a || a.status === 'ABSENT') throw fail('Allocation not found');
  const [r] = await q("SELECT * FROM allocation WHERE session_id = ? AND role = 'RESERVE' LIMIT 1", [a.session_id]);
  if (!r) throw fail('No reserve left. Pick a replacement manually.');
  await q("UPDATE allocation SET status = 'ABSENT' WHERE alloc_id = ?", [a.alloc_id]);
  await q("UPDATE allocation SET role = 'PRIMARY', session_hall_id = ? WHERE alloc_id = ?", [a.session_hall_id, r.alloc_id]);
  await q(`INSERT INTO replacement_log (session_id, session_hall_id, absent_faculty_id, replacement_faculty_id)
           VALUES (?,?,?,?)`, [a.session_id, a.session_hall_id, a.faculty_id, r.faculty_id]);
  res.json({ ok: true });
}));

// Manual override with rule checks
app.post('/api/assign', w(async (req, res) => {
  const { session_id, session_hall_id, faculty_id } = req.body;
  const [f] = await q('SELECT * FROM faculty WHERE faculty_id = ?', [faculty_id]);
  const [s] = await q('SELECT * FROM exam_session WHERE session_id = ?', [session_id]);
  if (f.dept_id === s.dept_id) throw fail(`${f.name} belongs to ${s.dept_id}, the department of this exam.`);
  if ((await q('SELECT 1 FROM unavailability WHERE faculty_id = ? AND session_id = ?', [faculty_id, session_id])).length)
    throw fail(`${f.name} marked this session as unavailable.`);
  if ((await q('SELECT 1 FROM allocation WHERE faculty_id = ? AND session_id = ?', [faculty_id, session_id])).length)
    throw fail(`${f.name} is already assigned in this session (clash).`);
  await q('INSERT INTO allocation (session_id, session_hall_id, faculty_id) VALUES (?,?,?)',
          [session_id, session_hall_id, faculty_id]);
  res.json({ ok: true });
}));

app.get('/api/fairness', w(async (req, res) => res.json(await q(`
  SELECT f.name, f.dept_id, f.base_duties, COUNT(a.alloc_id) AS current
  FROM faculty f
  LEFT JOIN allocation a ON a.faculty_id = f.faculty_id AND a.role = 'PRIMARY' AND a.status = 'ASSIGNED'
  GROUP BY f.faculty_id ORDER BY f.base_duties + COUNT(a.alloc_id) DESC, f.name`))));

app.get('/api/availability', w(async (req, res) => res.json({
  faculty: await q('SELECT faculty_id, name, dept_id FROM faculty ORDER BY name'),
  sessions: await q('SELECT session_id, subject, exam_date, shift FROM exam_session ORDER BY session_id'),
  un: await q('SELECT * FROM unavailability')
})));

app.post('/api/unavailability', w(async (req, res) => {
  const { faculty_id, session_id, on } = req.body;
  if (on) await q('INSERT IGNORE INTO unavailability VALUES (?,?)', [faculty_id, session_id]);
  else await q('DELETE FROM unavailability WHERE faculty_id = ? AND session_id = ?', [faculty_id, session_id]);
  res.json({ ok: true });
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
