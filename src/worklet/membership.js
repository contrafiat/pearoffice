// Membership ops: building them (append side) and checking them (apply side).
// Wire protocol proposal, sections 4 and 5.
//
// Every signed object carries a `purpose` and the `sheetId`, so a signature
// made for one action or one sheet can never be replayed as another.
//
// Roles: owner, editor, viewer. Only the owner signs `member`, `invite`,
// `inviteCancel` and `role`. Owners' and editors' devices are Autobase
// writers; viewers' devices hold the keys and replicate but never write.

const b4a = require('b4a')
const sodium = require('sodium-universal')
const { signValue, verifyValueWithSigner } = require('@peerloom/core/records')

const ROLES = ['owner', 'editor', 'viewer']
const INVITE_ROLES = ['editor', 'viewer']
const HEX64 = /^[0-9a-f]{64}$/
const HEX32 = /^[0-9a-f]{32}$/

const P = {
  member: 'pearsheet/member/v1',
  device: 'pearsheet/device/v1',
  invite: 'pearsheet/invite/v1',
  cancel: 'pearsheet/invite-cancel/v1',
  join: 'pearsheet/join/v1',
  role: 'pearsheet/role/v1',
  name: 'pearsheet/name/v1',
  seeder: 'pearsheet/seeder/v1'
}

const hex = (buf) => b4a.toString(buf, 'hex')

function randomHex (bytes) {
  const buf = b4a.alloc(bytes)
  sodium.randombytes_buf(buf)
  return hex(buf)
}

function b64url (buf) {
  return b4a.toString(buf, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url (s) {
  return b4a.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// The invite secret is a 32-byte Ed25519 seed. The invite record publishes its
// public key; the joiner proves it holds the secret by signing its claim.
function inviteKeyPair (seed) {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)
  return { publicKey, secretKey }
}

// --- append side -----------------------------------------------------------

function foundingOps ({ sheetId, identity, writerKey, name }) {
  const me = hex(identity.publicKey)
  return [
    { type: 'sheet', version: 1, owner: me },
    { type: 'device', device: deviceProof({ sheetId, identity, writerKey }) },
    { type: 'member', member: signValue({ purpose: P.member, sheetId, identity: me, role: 'owner', name: cleanName(name), v: 1, by: me }, identity.secretKey) }
  ]
}

function deviceProof ({ sheetId, identity, writerKey }) {
  return signValue({ purpose: P.device, sheetId, writerKey, identity: hex(identity.publicKey) }, identity.secretKey)
}

function inviteOp ({ sheetId, owner, role, expiresAt }) {
  if (!INVITE_ROLES.includes(role)) throw new Error('role must be editor or viewer')
  const seed = b4a.alloc(32)
  sodium.randombytes_buf(seed)
  const inviteId = randomHex(16)
  const kp = inviteKeyPair(seed)
  const by = hex(owner.publicKey)
  const invite = signValue({ purpose: P.invite, sheetId, inviteId, role, invitePub: hex(kp.publicKey), expiresAt, by }, owner.secretKey)
  return { op: { type: 'invite', invite }, inviteId, seed }
}

function cancelOp ({ sheetId, owner, inviteId }) {
  const by = hex(owner.publicKey)
  return { type: 'inviteCancel', cancel: signValue({ purpose: P.cancel, sheetId, inviteId, by }, owner.secretKey) }
}

function roleOp ({ sheetId, owner, identity, role, v }) {
  const by = hex(owner.publicKey)
  return { type: 'role', role: signValue({ purpose: P.role, sheetId, identity, role, v, by }, owner.secretKey) }
}

// A member renaming themselves. `n` names the version it replaces, so an old
// signed rename cannot be appended again to bring back an old name.
function nameOp ({ sheetId, identity, name, n }) {
  return { type: 'name', name: signValue({ purpose: P.name, sheetId, identity: hex(identity.publicKey), name: cleanName(name), n }, identity.secretKey) }
}

// "Back this sheet up to that seeder". Any owner or editor can add one.
function seederOp ({ sheetId, identity, seederKey }) {
  return { type: 'seeder', seeder: signValue({ purpose: P.seeder, sheetId, seederKey, identity: hex(identity.publicKey) }, identity.secretKey) }
}

// The joiner's half of an inviteUse: proof of the invite secret, and proof that
// this identity owns the device's writer key.
function claimFor ({ sheetId, inviteId, seed, identity, writerKey, name }) {
  const kp = inviteKeyPair(seed)
  const claim = signValue({ purpose: P.join, sheetId, inviteId, identity: hex(identity.publicKey), writerKey, name: cleanName(name), invitePub: hex(kp.publicKey) }, kp.secretKey)
  return { claim, device: deviceProof({ sheetId, identity, writerKey }) }
}

function cleanName (name) {
  return String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)
}

// --- links -------------------------------------------------------------------

function inviteLink ({ sheetId, groupKey, inviteId, seed, owner, role }) {
  const q = new URLSearchParams({ s: sheetId, t: groupKey, i: inviteId, k: b64url(seed), o: owner, r: role, v: '1' })
  return 'pearsheet://join?' + q.toString()
}

function parseInviteLink (link) {
  const m = /^pearsheet:\/\/join\?(.+)$/.exec(String(link).trim())
  if (!m) throw new Error('That is not a PearSheet invite link')
  const q = new URLSearchParams(m[1])
  const out = { sheetId: q.get('s'), groupKey: q.get('t'), inviteId: q.get('i'), seed: q.get('k') ? fromB64url(q.get('k')) : null, owner: q.get('o'), role: q.get('r'), v: q.get('v') }
  if (out.v !== '1') throw new Error('This invite needs a newer version of PearSheet')
  if (!out.sheetId || !HEX64.test(out.groupKey || '') || !HEX32.test(out.inviteId || '') || !out.seed || out.seed.length !== 32 || !HEX64.test(out.owner || '')) {
    throw new Error('This invite link is damaged')
  }
  return out
}

// --- apply side ----------------------------------------------------------------

async function get (view, key) {
  const node = await view.get(key)
  return node ? node.value : null
}

// Who appended this node: the identity mapped to its writer key, and that
// identity's role. Null when the writer key is not mapped.
async function actorOf (view, node) {
  const dev = await get(view, 'device/' + hex(node.from.key))
  if (!dev) return null
  const member = await get(view, 'member/' + dev.identity)
  return { identity: dev.identity, role: member ? member.role : null }
}

function signedBy (obj, signerField, purpose, sheetId) {
  return !!(obj && typeof obj === 'object' && obj.purpose === purpose && obj.sheetId === sheetId && verifyValueWithSigner(obj, signerField))
}

async function devicesOf (view, identity) {
  const out = []
  for await (const { value } of view.createReadStream({ gt: 'device/', lt: 'device/~' })) {
    if (value && value.identity === identity) out.push(value.writerKey)
  }
  return out
}

// Returns true if the op was a membership op (handled or rejected), false if
// it is some other type.
async function applyMembershipOp (op, { view, base, groupId, node, log }) {
  const sheetId = groupId
  const skip = (why) => { if (log) log('skip ' + op.type + ': ' + why); return true }

  if (op.type === 'sheet') {
    if (await get(view, 'sheet')) return skip('already founded')
    // Only the founding writer (whose core is the bootstrap) can found.
    if (!b4a.equals(node.from.key, base.key)) return skip('not the bootstrap writer')
    if (op.version !== 1 || !HEX64.test(op.owner || '')) return skip('bad sheet record')
    await view.put('sheet', { sheetId, owner: op.owner, version: 1 })
    return true
  }

  if (op.type === 'device') {
    const sheet = await get(view, 'sheet')
    const d = op.device
    if (!sheet || !signedBy(d, 'identity', P.device, sheetId)) return skip('bad device proof')
    if (d.writerKey !== hex(node.from.key)) return skip('a device can only register itself')
    // The founder registers before its member record exists; everyone else
    // arrives through inviteUse. Linked devices of an owner or editor can
    // register themselves once device linking lands.
    const member = await get(view, 'member/' + d.identity)
    if (d.identity !== sheet.owner && !(member && (member.role === 'owner' || member.role === 'editor'))) return skip('not an owner or editor')
    await view.put('device/' + d.writerKey, { identity: d.identity, writerKey: d.writerKey })
    return true
  }

  if (op.type === 'member') {
    const sheet = await get(view, 'sheet')
    const m = op.member
    if (!sheet || !signedBy(m, 'by', P.member, sheetId) || m.by !== sheet.owner) return skip('not signed by the owner')
    const actor = await actorOf(view, node)
    if (!actor || actor.identity !== sheet.owner) return skip('not appended by an owner device')
    // In v1 the only member op is the owner's own founding record.
    if (m.identity !== sheet.owner || m.role !== 'owner' || await get(view, 'member/' + m.identity)) return skip('only the founding owner record')
    await view.put('member/' + m.identity, { identity: m.identity, role: 'owner', name: m.name || '', v: 1 })
    return true
  }

  if (op.type === 'invite') {
    const sheet = await get(view, 'sheet')
    const i = op.invite
    if (!sheet || !signedBy(i, 'by', P.invite, sheetId) || i.by !== sheet.owner) return skip('not signed by the owner')
    if (!HEX32.test(i.inviteId || '') || !INVITE_ROLES.includes(i.role) || !HEX64.test(i.invitePub || '') || typeof i.expiresAt !== 'number') return skip('bad invite')
    if (await get(view, 'invite/' + i.inviteId)) return skip('duplicate invite')
    await view.put('invite/' + i.inviteId, { inviteId: i.inviteId, role: i.role, invitePub: i.invitePub, expiresAt: i.expiresAt })
    return true
  }

  if (op.type === 'inviteCancel') {
    const sheet = await get(view, 'sheet')
    const c = op.cancel
    if (!sheet || !signedBy(c, 'by', P.cancel, sheetId) || c.by !== sheet.owner) return skip('not signed by the owner')
    if (!(await get(view, 'invite/' + c.inviteId))) return skip('unknown invite')
    if (await get(view, 'invite-used/' + c.inviteId)) return skip('already used or cancelled')
    await view.put('invite-used/' + c.inviteId, { cancelled: true })
    return true
  }

  if (op.type === 'inviteUse') {
    const actor = await actorOf(view, node)
    if (!actor || (actor.role !== 'owner' && actor.role !== 'editor')) return skip('appender is not an owner or editor')
    const { claim, device } = op
    if (!signedBy(claim, 'invitePub', P.join, sheetId) || !signedBy(device, 'identity', P.device, sheetId)) return skip('bad signatures')
    if (claim.identity !== device.identity || claim.writerKey !== device.writerKey) return skip('claim and device disagree')
    const invite = await get(view, 'invite/' + claim.inviteId)
    if (!invite || invite.invitePub !== claim.invitePub) return skip('unknown invite')
    if (await get(view, 'invite-used/' + claim.inviteId)) return skip('invite already used or cancelled')
    if (await get(view, 'member/' + claim.identity)) return skip('already a member')
    await view.put('invite-used/' + claim.inviteId, { identity: claim.identity })
    await view.put('member/' + claim.identity, { identity: claim.identity, role: invite.role, name: claim.name || '', v: 1, via: claim.inviteId })
    await view.put('device/' + claim.writerKey, { identity: claim.identity, writerKey: claim.writerKey })
    if (invite.role === 'editor') await base.addWriter(b4a.from(claim.writerKey, 'hex'), { indexer: true })
    return true
  }

  if (op.type === 'name') {
    const r = op.name
    if (!signedBy(r, 'identity', P.name, sheetId)) return skip('bad signature')
    const actor = await actorOf(view, node)
    if (!actor || actor.identity !== r.identity) return skip('can only rename yourself')
    const member = await get(view, 'member/' + r.identity)
    if (!member || r.n !== (member.n || 0) + 1) return skip('stale rename')
    await view.put('member/' + r.identity, { ...member, name: r.name, n: r.n })
    return true
  }

  if (op.type === 'seeder') {
    const r = op.seeder
    if (!signedBy(r, 'identity', P.seeder, sheetId) || !HEX64.test(r.seederKey || '')) return skip('bad seeder record')
    const actor = await actorOf(view, node)
    if (!actor || actor.identity !== r.identity || (actor.role !== 'owner' && actor.role !== 'editor')) return skip('not an owner or editor')
    if (await get(view, 'seeder/' + r.seederKey)) return skip('already listed')
    await view.put('seeder/' + r.seederKey, { seederKey: r.seederKey, addedBy: r.identity })
    return true
  }

  if (op.type === 'role') {
    const sheet = await get(view, 'sheet')
    const r = op.role
    if (!sheet || !signedBy(r, 'by', P.role, sheetId) || r.by !== sheet.owner) return skip('not signed by the owner')
    if (!INVITE_ROLES.includes(r.role)) return skip('bad role')
    const member = await get(view, 'member/' + r.identity)
    if (!member || member.role === 'owner') return skip('unknown member or the owner')
    // Each role change names the version it replaces, so an old signed op
    // cannot be appended again later to undo a newer change.
    if (r.v !== (member.v || 1) + 1) return skip('stale role change')
    await view.put('member/' + r.identity, { ...member, role: r.role, v: r.v })
    for (const writerKey of await devicesOf(view, r.identity)) {
      const key = b4a.from(writerKey, 'hex')
      if (r.role === 'editor') await base.addWriter(key, { indexer: true })
      else if (typeof base.removeable !== 'function' || base.removeable(key)) {
        try { await base.removeWriter(key) } catch (e) { if (log) log('removeWriter failed: ' + e.message) }
      }
    }
    return true
  }

  return false
}

// May this node append a `y` (sheet content) op?
async function mayEdit (view, node) {
  const actor = await actorOf(view, node)
  return !!(actor && (actor.role === 'owner' || actor.role === 'editor'))
}

module.exports = {
  ROLES,
  P,
  foundingOps,
  inviteOp,
  cancelOp,
  roleOp,
  nameOp,
  seederOp,
  claimFor,
  inviteKeyPair,
  inviteLink,
  parseInviteLink,
  applyMembershipOp,
  mayEdit,
  actorOf,
  cleanName
}
