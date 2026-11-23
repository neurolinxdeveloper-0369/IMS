import { createServer } from 'node:http'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'

const pool = new pg.Pool({ connectionTimeoutMillis: 3000 })
const deriveKey = promisify(scrypt)
const adminId = process.env.IMS_ADMIN_ID
const adminHash = process.env.IMS_ADMIN_HASH
const allowedOrigin = process.env.IMS_ORIGIN ?? 'https://neurolinx.in'
const cookieName = '__Secure-ims_session'
const sessionSeconds = 8 * 60 * 60
const cookieAttributes = 'Path=/IMS/api/; HttpOnly; Secure; SameSite=Strict'
const attemptWindow = 5 * 60 * 1000
const attempts = new Map()

if (!adminId || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(adminHash ?? '')) {
  throw new Error('Set the IMS administrator ID and scrypt password hash.')
}

await pool.query(`
  CREATE TABLE IF NOT EXISTS ims_users (
    user_id text PRIMARY KEY,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'manager', 'store_person'))
  );
  CREATE TABLE IF NOT EXISTS ims_sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES ims_users(user_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
`)
await pool.query(
  'INSERT INTO ims_users (user_id, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
  [adminId, adminHash, 'admin'],
)

pool.on('error', () => console.error('An idle IMS database connection failed.'))
setInterval(() => {
  for (const [ip, entry] of attempts) {
    if (entry.until <= Date.now()) attempts.delete(ip)
  }
  pool.query('DELETE FROM ims_sessions WHERE expires_at <= now()')
    .catch(() => console.error('IMS session cleanup failed.'))
}, attemptWindow).unref()

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function sessionToken(request) {
  const value = request.headers.cookie?.split('; ')
    .find((cookie) => cookie.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  return /^[a-f0-9]{64}$/.test(value ?? '') ? value : null
}

function json(response, code, data, cookie) {
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')
  if (cookie) response.setHeader('Set-Cookie', cookie)
  response.writeHead(code).end(JSON.stringify(data))
}

async function readCredentials(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 2048) return {}
  }
  try {
    return JSON.parse(body) ?? {}
  } catch {
    return {}
  }
}

function allowAttempt(request) {
  const ip = request.headers['x-real-ip'] || request.socket.remoteAddress
  const now = Date.now()
  const current = attempts.get(ip)
  if (!current || current.until <= now) {
    if (!current && attempts.size >= 4000) return false
    attempts.set(ip, { count: 1, until: now + attemptWindow })
    return true
  }
  current.count += 1
  return current.count <= 12
}

async function signIn(request, response) {
  if (!allowAttempt(request)) {
    return json(response, 429, { message: 'Too many attempts. Try again in a few minutes.' })
  }
  const { username, password } = await readCredentials(request)
  if (typeof username !== 'string' || typeof password !== 'string'
      || !username.trim() || !password || username.length > 64 || password.length > 256) {
    return json(response, 400, { message: 'Enter a valid User ID and password.' })
  }

  const { rows: [user] } = await pool.query(
    'SELECT user_id, role, password_hash FROM ims_users WHERE user_id = $1',
    [username.trim()],
  )
  const [salt, expected] = (user?.password_hash ?? adminHash).split(':')
  const supplied = await deriveKey(password, Buffer.from(salt, 'hex'), 64)
  if (!timingSafeEqual(supplied, Buffer.from(expected, 'hex')) || !user) {
    return json(response, 401, { message: 'Invalid User ID or password.' })
  }

  const token = randomBytes(32).toString('hex')
  const previous = sessionToken(request)
  if (previous) await pool.query('DELETE FROM ims_sessions WHERE token_hash = $1', [tokenHash(previous)])
  await pool.query('INSERT INTO ims_sessions VALUES ($1, $2, $3)', [
    tokenHash(token), user.user_id, new Date(Date.now() + sessionSeconds * 1000),
  ])
  return json(response, 200, { userId: user.user_id, role: user.role },
    `${cookieName}=${token}; ${cookieAttributes}; Max-Age=${sessionSeconds}`)
}

async function route(request, response) {
  const { method, url } = request
  if (method === 'GET' && url === '/health') {
    await pool.query('SELECT 1')
    return json(response, 200, { ok: true })
  }
  if (method === 'POST' && request.headers.origin !== allowedOrigin) {
    return json(response, 403, { message: 'Request origin is not allowed.' })
  }
  if (method === 'POST' && url === '/IMS/api/login') return signIn(request, response)
  const token = sessionToken(request)
  if (method === 'GET' && url === '/IMS/api/session') {
    if (!token) return json(response, 401, {})
    const { rows: [user] } = await pool.query(`
      SELECT u.user_id AS "userId", u.role FROM ims_sessions s
      JOIN ims_users u ON u.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
    `, [tokenHash(token)])
    return user ? json(response, 200, user) : json(response, 401, {})
  }
  if (method === 'POST' && url === '/IMS/api/logout') {
    if (token) await pool.query('DELETE FROM ims_sessions WHERE token_hash = $1', [tokenHash(token)])
    return json(response, 200, {}, `${cookieName}=; ${cookieAttributes}; Max-Age=0`)
  }
  return json(response, 404, {})
}

createServer((request, response) => {
  route(request, response).catch(() => {
    console.error('IMS authentication request failed.')
    if (!response.headersSent) json(response, 503, { message: 'Sign-in service is unavailable.' })
    else response.end()
  })
}).listen(3001, '0.0.0.0')
