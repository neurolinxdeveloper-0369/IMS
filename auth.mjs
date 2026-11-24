import { createServer } from 'node:http'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import pg from 'pg'
import { roles } from './inventory-shared.mjs'
import { addBomComponent, audit, importBom, initInventory, readAudit, readInventory, RequestError, saveInventory, transaction } from './inventory.mjs'

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
  ALTER TABLE ims_users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
`)
await initInventory(pool)
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

async function readBody(request, maxLength = 2048) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maxLength) throw new RequestError(413, 'The request is too large.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) ?? {}
  } catch {
    return {}
  }
}

async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':')
  const supplied = await deriveKey(password, Buffer.from(salt, 'hex'), 64)
  return timingSafeEqual(supplied, Buffer.from(expected, 'hex'))
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new RequestError(400, 'Use a password between 12 and 256 characters.')
  }
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt, 64)
  return salt.toString('hex') + ':' + key.toString('hex')
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
  const { username, password } = await readBody(request)
  if (typeof username !== 'string' || typeof password !== 'string'
      || !username.trim() || !password || username.length > 64 || password.length > 256) {
    return json(response, 400, { message: 'Enter a valid User ID and password.' })
  }

  const { rows: [user] } = await pool.query(
    'SELECT user_id, role, password_hash, must_change_password FROM ims_users WHERE user_id = $1',
    [username.trim()],
  )
  if (!(await verifyPassword(password, user?.password_hash ?? adminHash)) || !user) {
    return json(response, 401, { message: 'Invalid User ID or password.' })
  }

  const token = randomBytes(32).toString('hex')
  const previous = sessionToken(request)
  await transaction(pool, async (db) => {
    const current = await db.query('SELECT 1 FROM ims_users WHERE user_id = $1 AND password_hash = $2 FOR SHARE', [
      user.user_id, user.password_hash,
    ])
    if (!current.rowCount) throw new RequestError(401, 'Invalid User ID or password.')
    if (previous) await db.query('DELETE FROM ims_sessions WHERE token_hash = $1', [tokenHash(previous)])
    await db.query('INSERT INTO ims_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash(token), user.user_id, new Date(Date.now() + sessionSeconds * 1000),
    ])
  })
  return json(response, 200, { userId: user.user_id, role: user.role, mustChangePassword: user.must_change_password },
    `${cookieName}=${token}; ${cookieAttributes}; Max-Age=${sessionSeconds}`)
}

async function authenticatedUser(token) {
  if (!token) return null
  const { rows: [user] } = await pool.query(`
    SELECT u.user_id AS "userId", u.role, u.must_change_password AS "mustChangePassword" FROM ims_sessions s
    JOIN ims_users u ON u.user_id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
  `, [tokenHash(token)])
  return user ?? null
}

async function changePassword(user, token, { current, password }) {
  if (typeof current !== 'string' || !current || current.length > 256 || current === password) {
    throw new RequestError(400, 'Enter your current password and a different new password.')
  }
  const hash = await hashPassword(password)
  await transaction(pool, async (db) => {
    const { rows: [record] } = await db.query(
      'SELECT password_hash FROM ims_users WHERE user_id = $1 FOR UPDATE', [user.userId],
    )
    if (!(await verifyPassword(current, record.password_hash))) {
      throw new RequestError(403, 'The current password is incorrect.')
    }
    await db.query('UPDATE ims_users SET password_hash = $1, must_change_password = false WHERE user_id = $2', [hash, user.userId])
    await db.query('DELETE FROM ims_sessions WHERE user_id = $1 AND token_hash <> $2', [user.userId, tokenHash(token)])
    await audit(db, user.userId, 'Changed password', user.userId)
  })
}

async function manageUser(actor, { userId, role, password }, reset) {
  if (typeof userId !== 'string' || !/^[\w.-]{1,64}$/.test(userId)) {
    throw new RequestError(400, 'Enter a valid User ID.')
  }
  if (!reset && !['manager', 'store_person'].includes(role)) {
    throw new RequestError(400, 'Select Manager or Store Person.')
  }
  const hash = await hashPassword(password)
  await transaction(pool, async (db) => {
    if (reset) {
      const changed = await db.query(
        "UPDATE ims_users SET password_hash = $1, must_change_password = true WHERE user_id = $2 AND role <> 'admin'",
        [hash, userId],
      )
      if (!changed.rowCount) throw new RequestError(404, 'Choose an existing Manager or Store Person.')
      await db.query('DELETE FROM ims_sessions WHERE user_id = $1', [userId])
    } else {
      await db.query('INSERT INTO ims_users (user_id, password_hash, role, must_change_password) VALUES ($1, $2, $3, true)', [userId, hash, role])
    }
    await audit(db, actor.userId, reset ? 'Reset password' : 'Created ' + roles[role], userId)
  })
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
    const user = await authenticatedUser(token)
    return user ? json(response, 200, user) : json(response, 401, {})
  }
  if (method === 'POST' && url === '/IMS/api/logout') {
    if (token) await pool.query('DELETE FROM ims_sessions WHERE token_hash = $1', [tokenHash(token)])
    return json(response, 200, {}, `${cookieName}=; ${cookieAttributes}; Max-Age=0`)
  }
  if (!url?.startsWith('/IMS/api/')) return json(response, 404, {})
  const user = await authenticatedUser(token)
  if (!user) return json(response, 401, { message: 'Sign in again to continue.' })
  if (method === 'POST' && url === '/IMS/api/change-password') {
    if (!allowAttempt(request)) throw new RequestError(429, 'Too many attempts. Try again in a few minutes.')
    await changePassword(user, token, await readBody(request))
    return json(response, 200, {})
  }
  if (user.mustChangePassword) throw new RequestError(403, 'Change your temporary password to continue.')
  if (method === 'GET' && url === '/IMS/api/inventory') return json(response, 200, await readInventory(pool, user))
  if (method === 'POST' && url === '/IMS/api/inventory/boms/import') {
    return json(response, 200, await importBom(pool, user, await readBody(request, 768 * 1024)))
  }
  if (method === 'POST' && url === '/IMS/api/inventory/boms/components') {
    return json(response, 200, await addBomComponent(pool, user, await readBody(request, 8192)))
  }
  const record = /^\/IMS\/api\/inventory\/([a-z]+)$/.exec(url)
  if (method === 'POST' && record) {
    return json(response, 200, await saveInventory(pool, user, record[1], await readBody(request, 64 * 1024)))
  }
  if (method === 'GET' && url === '/IMS/api/audit' && user.role !== 'store_person') {
    return json(response, 200, await readAudit(pool))
  }
  if (url.startsWith('/IMS/api/users')) {
    if (user.role !== 'admin') throw new RequestError(403, 'This action requires an administrator.')
    if (method === 'GET' && url === '/IMS/api/users') {
      const { rows } = await pool.query('SELECT user_id AS "userId", role, must_change_password AS "mustChangePassword" FROM ims_users ORDER BY user_id')
      return json(response, 200, rows)
    }
    if (method === 'POST' && ['/IMS/api/users', '/IMS/api/users/reset'].includes(url)) {
      await manageUser(user, await readBody(request), url.endsWith('/reset'))
      return json(response, 200, {})
    }
  }
  return json(response, 404, {})
}

createServer((request, response) => {
  route(request, response).catch((error) => {
    if (error instanceof RequestError && !response.headersSent) {
      return json(response, error.status, { message: error.message })
    }
    console.error('IMS authentication request failed.')
    if (!response.headersSent) json(response, 503, { message: 'Sign-in service is unavailable.' })
    else response.end()
  })
}).listen(Number(process.env.IMS_AUTH_PORT ?? 3001), process.env.IMS_AUTH_HOST ?? '0.0.0.0')
