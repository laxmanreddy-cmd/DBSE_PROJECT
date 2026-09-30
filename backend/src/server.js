import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { pool } from './db.js'

const app = express()
const port = Number(process.env.PORT || 5000)
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '1mb' }))

const money = n => Number(Number(n || 0).toFixed(2))
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const positive = n => Number.isFinite(Number(n)) && Number(n) > 0
let schemaColumnsPromise
const schemaColumns = () => {
  if (!schemaColumnsPromise) {
    schemaColumnsPromise = pool.query(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`)
      .then(([rows]) => new Map(rows.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row.COLUMN_TYPE])))
      .catch(error => { schemaColumnsPromise = null; throw error })
  }
  return schemaColumnsPromise
}
const dbColumn = async (table, ...candidates) => {
  const columns = await schemaColumns()
  const column = candidates.find(name => columns.has(`${table}.${name}`))
  if (!column) throw fail(`Database table ${table} is missing a required column.`, 500)
  return `\`${column}\``
}

app.get('/', (_req, res) => res.json({ name: 'Expense Splitter Pro API', status: 'running', health: '/api/health' }))

app.get('/api/health', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }) }
  catch (e) { next(e) }
})

const sessions = new Map()
const sessionCookie = 'splitflow_session'
const sessionLifetime = 12 * 60 * 60
const sessionToken = req => {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${sessionCookie}=`))
  return cookie?.slice(sessionCookie.length + 1)
}
const activeSession = req => {
  const token = sessionToken(req)
  const session = token && sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token)
    return null
  }
  return session
}
const matchesSecret = (provided, expected) => {
  const providedBytes = Buffer.from(String(provided))
  const expectedBytes = Buffer.from(String(expected))
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}

app.post('/api/auth/login', (req, res) => {
  const expectedPassword = process.env.APP_PASSWORD
  if (!expectedPassword) return res.status(503).json({ message: 'Login setup required. Add APP_PASSWORD to backend/.env and restart the API.' })
  const username = String(req.body?.username || '')
  const password = String(req.body?.password || '')
  const expectedUsername = process.env.APP_USERNAME || 'Laxman'
  if (!matchesSecret(username, expectedUsername) || !matchesSecret(password, expectedPassword))
    return res.status(401).json({ message: 'Username or password is incorrect.' })

  const token = randomBytes(32).toString('hex')
  sessions.set(token, { username, expiresAt: Date.now() + sessionLifetime * 1000 })
  res.setHeader('Set-Cookie', `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetime}`)
  res.json({ username })
})

app.get('/api/auth/session', (req, res) => {
  const session = activeSession(req)
  if (!session) return res.status(401).json({ message: 'Sign in to continue.' })
  res.json({ username: session.username })
})

app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req)
  if (token) sessions.delete(token)
  res.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
  res.json({ success: true })
})

app.use('/api', (req, res, next) => {
  const session = activeSession(req)
  if (!session) return res.status(401).json({ message: 'Your session has ended. Please sign in again.' })
  req.auth = session
  next()
})

app.get('/api/users', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT user_id, name, email FROM users ORDER BY name')
    res.json(rows)
  } catch (e) { next(e) }
})

app.get('/api/groups', async (_req, res, next) => {
  try {
    const budget = await dbColumn('groups_tbl', 'budget', 'budget_limit')
    const [rows] = await pool.query(`
      SELECT g.group_id, g.name, g.description, g.${budget} AS budget, g.created_at,
             COUNT(DISTINCT gm.user_id) members,
             COALESCE(SUM(DISTINCT e.amount),0) spent
      FROM groups_tbl g
      LEFT JOIN group_members gm ON gm.group_id=g.group_id
      LEFT JOIN expenses e ON e.group_id=g.group_id
      GROUP BY g.group_id ORDER BY g.group_id DESC`)
    res.json(rows)
  } catch (e) { next(e) }
})

app.post('/api/groups', async (req, res, next) => {
  try {
    const budgetColumn = await dbColumn('groups_tbl', 'budget', 'budget_limit')
    const { name, description = '', budget = 0 } = req.body
    if (!name?.trim() || !positive(budget)) throw fail('Group name and a positive budget are required.')
    const [r] = await pool.execute(`INSERT INTO groups_tbl(name,description,${budgetColumn}) VALUES(?,?,?)`,
      [name.trim(), description.trim(), money(budget)])
    const [rows] = await pool.execute(`SELECT group_id,name,description,${budgetColumn} AS budget,created_at FROM groups_tbl WHERE group_id=?`, [r.insertId])
    res.status(201).json(rows[0])
  } catch (e) { next(e) }
})

app.get('/api/groups/:id/members', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT u.user_id,u.name,u.email,gm.role,gm.joined_at
      FROM group_members gm JOIN users u ON u.user_id=gm.user_id
      WHERE gm.group_id=? ORDER BY u.name`, [req.params.id])
    res.json(rows)
  } catch (e) { next(e) }
})

app.delete('/api/groups/:id/members/:userId', async (req, res, next) => {
  const connection = await pool.getConnection()
  let transactionStarted = false
  try {
    const groupId = Number(req.params.id)
    const userId = Number(req.params.userId)
    if (!Number.isInteger(groupId) || !Number.isInteger(userId)) throw fail('A valid group and member are required.')
    await connection.beginTransaction()
    transactionStarted = true
    const [membership] = await connection.execute(
      'SELECT role FROM group_members WHERE group_id=? AND user_id=? FOR UPDATE', [groupId, userId])
    if (!membership.length) throw fail('This person is not a member of the group.', 404)
    if (['owner', 'admin'].includes(String(membership[0].role).toLowerCase()))
      throw fail('The group owner or admin cannot be removed.', 400)
    await connection.execute('DELETE FROM group_members WHERE group_id=? AND user_id=?', [groupId, userId])
    await connection.commit()
    res.json({ success: true })
  } catch (e) {
    if (transactionStarted) await connection.rollback()
    next(e)
  } finally { connection.release() }
})

app.post('/api/groups/:id/members', async (req, res, next) => {
  const connection = await pool.getConnection()
  let transactionStarted = false
  try {
    const { user_id, name, email, role = 'member' } = req.body
    await connection.beginTransaction()
    transactionStarted = true
    let memberId
    if (user_id !== undefined && user_id !== null && user_id !== '') {
      if (!Number.isInteger(Number(user_id))) throw fail('A valid user is required.')
      memberId = Number(user_id)
    } else {
      const cleanName = String(name || '').trim()
      const cleanEmail = String(email || '').trim().toLowerCase()
      if (!cleanName || cleanName.length > 80) throw fail('Enter a name up to 80 characters.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 120)
        throw fail('Enter a valid email address up to 120 characters.')
      const [existing] = await connection.execute('SELECT user_id FROM users WHERE email=?', [cleanEmail])
      if (existing.length) throw fail('That email already belongs to a user. Select them from existing users instead.', 409)
      const [created] = await connection.execute('INSERT INTO users(name,email) VALUES(?,?)', [cleanName, cleanEmail])
      memberId = created.insertId
    }
    const columns = await schemaColumns()
    const roleType = columns.get('group_members.role') || ''
    const isUppercaseRole = roleType.includes("'OWNER'")
    const storedRole = role === 'admin' ? (isUppercaseRole ? 'OWNER' : 'admin') : (isUppercaseRole ? 'MEMBER' : 'member')
    await connection.execute('INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,?)',
      [req.params.id, memberId, storedRole])
    await connection.commit()
    res.status(201).json({ success: true, user_id: memberId })
  } catch (e) {
    if (transactionStarted) await connection.rollback()
    next(e)
  } finally { connection.release() }
})

app.get('/api/groups/:id/expenses', async (req, res, next) => {
  try {
    const description = await dbColumn('expenses', 'description', 'title')
    const splitType = await dbColumn('expenses', 'split_type', 'split_method')
    const [rows] = await pool.execute(`
      SELECT e.expense_id,e.${description} AS description,e.amount,e.category,e.${splitType} AS split_type,e.expense_date,
             u.user_id payer_id,u.name payer,
             COUNT(es.user_id) participants
      FROM expenses e JOIN users u ON u.user_id=e.payer_id
      LEFT JOIN expense_splits es ON es.expense_id=e.expense_id
      WHERE e.group_id=? GROUP BY e.expense_id ORDER BY e.expense_date DESC,e.expense_id DESC`, [req.params.id])
    res.json(rows)
  } catch (e) { next(e) }
})

app.post('/api/groups/:id/expenses', async (req, res, next) => {
  const connection = await pool.getConnection()
  try {
    const descriptionColumn = await dbColumn('expenses', 'description', 'title')
    const splitTypeColumn = await dbColumn('expenses', 'split_type', 'split_method')
    const shareColumn = await dbColumn('expense_splits', 'share', 'share_amount')
    const { description, amount, payer_id, category = 'Other', split_type = 'equal', splits = [] } = req.body
    const total = money(amount)
    if (!description?.trim() || !positive(total) || !Number.isInteger(Number(payer_id))) throw fail('Description, amount and payer are required.')
    if (!['equal','exact','percentage'].includes(split_type)) throw fail('Invalid split type.')
    if (!Array.isArray(splits) || !splits.length) throw fail('Add at least one participant.')
    const ids = splits.map(s => Number(s.user_id))
    if (ids.some(x => !Number.isInteger(x)) || new Set(ids).size !== ids.length) throw fail('Participants must be unique.')
    const shares = splits.map(s => money(s.share))
    if (split_type === 'equal') {
      const each = money(total / splits.length)
      shares.fill(each)
      shares[shares.length - 1] = money(total - shares.slice(0,-1).reduce((a,b)=>a+b,0))
    } else if (split_type === 'percentage') {
      if (Math.abs(shares.reduce((a,b)=>a+b,0)-100) > 0.01) throw fail('Percentages must total 100%.')
      shares.splice(0, shares.length, ...shares.map(p => money(total*p/100)))
      shares[shares.length - 1] = money(total - shares.slice(0,-1).reduce((a,b)=>a+b,0))
    } else if (Math.abs(shares.reduce((a,b)=>a+b,0)-total) > 0.01) throw fail('Exact shares must equal the expense amount.')
    await connection.beginTransaction()
    const [valid] = await connection.execute(
      `SELECT user_id FROM group_members WHERE group_id=? AND user_id IN (${ids.map(()=>'?').join(',')})`,
      [req.params.id, ...ids])
    if (valid.length !== ids.length) throw fail('Every participant must belong to this group.')
    const [expense] = await connection.execute(
      `INSERT INTO expenses(group_id,payer_id,${descriptionColumn},amount,category,${splitTypeColumn}) VALUES(?,?,?,?,?,?)`,
      [req.params.id,payer_id,description.trim(),total,category,split_type])
    for (let i=0;i<ids.length;i++) await connection.execute(
      `INSERT INTO expense_splits(expense_id,user_id,${shareColumn}) VALUES(?,?,?)`,[expense.insertId,ids[i],shares[i]])
    await connection.commit()
    res.status(201).json({ expense_id: expense.insertId, shares })
  } catch (e) {
    await connection.rollback()
    next(e)
  } finally { connection.release() }
})

app.get('/api/groups/:id/balances', async (req, res, next) => {
  try {
    const share = await dbColumn('expense_splits', 'share', 'share_amount')
    const [members] = await pool.execute(`
      SELECT DISTINCT u.user_id,u.name FROM users u
      WHERE EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=? AND gm.user_id=u.user_id)
         OR EXISTS(SELECT 1 FROM expenses e WHERE e.group_id=? AND e.payer_id=u.user_id)
         OR EXISTS(SELECT 1 FROM expense_splits es JOIN expenses e ON e.expense_id=es.expense_id
                   WHERE e.group_id=? AND es.user_id=u.user_id)
         OR EXISTS(SELECT 1 FROM settlements s WHERE s.group_id=? AND (s.from_user_id=u.user_id OR s.to_user_id=u.user_id))
      ORDER BY u.name`, [req.params.id,req.params.id,req.params.id,req.params.id])
    const balance = Object.fromEntries(members.map(m => [m.user_id,{...m, paid:0, owed:0, balance:0}]))
    const [paid] = await pool.execute('SELECT payer_id user_id,SUM(amount) value FROM expenses WHERE group_id=? GROUP BY payer_id',[req.params.id])
    const [owed] = await pool.execute(`
      SELECT es.user_id,SUM(es.${share}) value FROM expense_splits es JOIN expenses e ON e.expense_id=es.expense_id
      WHERE e.group_id=? GROUP BY es.user_id`,[req.params.id])
    const [settled] = await pool.execute(`
      SELECT from_user_id,to_user_id,SUM(amount) value FROM settlements
      WHERE group_id=? GROUP BY from_user_id,to_user_id`,[req.params.id])
    paid.forEach(x => { if(balance[x.user_id]) balance[x.user_id].paid=money(x.value) })
    owed.forEach(x => { if(balance[x.user_id]) balance[x.user_id].owed=money(x.value) })
    Object.values(balance).forEach(x => { x.balance=money(x.paid-x.owed) })
    settled.forEach(x => {
      if(balance[x.from_user_id]) balance[x.from_user_id].balance=money(balance[x.from_user_id].balance+Number(x.value))
      if(balance[x.to_user_id]) balance[x.to_user_id].balance=money(balance[x.to_user_id].balance-Number(x.value))
    })
    res.json(Object.values(balance).map(x => ({...x,balance:money(x.balance)})))
  } catch (e) { next(e) }
})

app.get('/api/groups/:id/settlements', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT s.settlement_id,s.amount,s.settled_at,
             f.name from_name,t.name to_name
      FROM settlements s JOIN users f ON f.user_id=s.from_user_id JOIN users t ON t.user_id=s.to_user_id
      WHERE s.group_id=? ORDER BY s.settled_at DESC,s.settlement_id DESC`,[req.params.id])
    res.json(rows)
  } catch (e) { next(e) }
})

app.post('/api/groups/:id/settlements', async (req, res, next) => {
  try {
    const { from_user_id,to_user_id,amount } = req.body
    if (!Number.isInteger(Number(from_user_id)) || !Number.isInteger(Number(to_user_id)) || !positive(amount))
      throw fail('Valid sender, receiver and amount are required.')
    if (Number(from_user_id) === Number(to_user_id)) throw fail('Sender and receiver must be different.')
    await pool.execute('INSERT INTO settlements(group_id,from_user_id,to_user_id,amount) VALUES(?,?,?,?)',
      [req.params.id,from_user_id,to_user_id,money(amount)])
    res.status(201).json({ success:true })
  } catch (e) { next(e) }
})

app.get('/api/groups/:id/dashboard', async (req, res, next) => {
  try {
    const id = req.params.id
    const budget = await dbColumn('groups_tbl', 'budget', 'budget_limit')
    const description = await dbColumn('expenses', 'description', 'title')
    const [[group]] = await pool.execute(`SELECT group_id,name,description,${budget} AS budget,created_at FROM groups_tbl WHERE group_id=?`,[id])
    if (!group) throw fail('Group not found.',404)
    const [[summary]] = await pool.execute(`
      SELECT COUNT(*) expense_count,COALESCE(SUM(amount),0) spent
      FROM expenses WHERE group_id=?`,[id])
    const [categories] = await pool.execute(`
      SELECT category,SUM(amount) value FROM expenses WHERE group_id=? GROUP BY category ORDER BY value DESC`,[id])
    const [recent] = await pool.execute(`
      SELECT e.expense_id,e.${description} AS description,e.amount,e.category,e.expense_date,u.name payer
      FROM expenses e JOIN users u ON u.user_id=e.payer_id
      WHERE e.group_id=? ORDER BY e.expense_date DESC,e.expense_id DESC LIMIT 6`,[id])
    res.json({ group, summary, categories, recent })
  } catch (e) { next(e) }
})

app.use((err,_req,res,_next) => {
  console.error(err)
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message:'That record already exists.' })
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ message:'Referenced user or group does not exist.' })
  res.status(err.status || 500).json({ message: err.message || 'Server error.' })
})

app.listen(port, () => console.log(`Expense Splitter API running at http://localhost:${port}`))
