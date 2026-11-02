import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crxSignedBy, publicKeyDer } from './pack-crx'

const varint = (value: number): number[] => {
  const out: number[] = []
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80)
    value = Math.floor(value / 0x80)
  }
  return [...out, value]
}
const field = (number: number, bytes: Uint8Array) =>
  Buffer.concat([
    Buffer.from([...varint(number * 8 + 2), ...varint(bytes.length)]),
    bytes,
  ])
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const der = (key: KeyObject) =>
  new Uint8Array(key.export({ type: 'spki', format: 'der' }))

/** A CRX3 as Chrome writes it: one RSA proof over the signed header data and the zip. */
function crx(
  signer: { privateKey: KeyObject; publicKey: KeyObject },
  zip: Buffer
) {
  const signedData = field(1, Buffer.from('0123456789abcdef'))
  const signature = sign(
    'sha256',
    Buffer.concat([
      Buffer.from('CRX3 SignedData\0'),
      u32(signedData.length),
      signedData,
      zip,
    ]),
    signer.privateKey
  )
  const proof = Buffer.concat([
    field(1, der(signer.publicKey)),
    field(2, signature),
  ])
  const header = Buffer.concat([field(2, proof), field(10000, signedData)])
  return new Uint8Array(
    Buffer.concat([
      Buffer.from('Cr24'),
      u32(3),
      u32(header.length),
      header,
      zip,
    ])
  )
}

describe('crxSignedBy', () => {
  const store = pair()
  const zip = Buffer.from('PK\x03\x04 the extension')

  test('accepts a CRX signed with the key', () => {
    expect(crxSignedBy(crx(store, zip), der(store.publicKey))).toBe(true)
  })

  test('rejects a CRX signed with another key', () => {
    expect(crxSignedBy(crx(pair(), zip), der(store.publicKey))).toBe(false)
  })

  test('rejects a CRX whose zip was changed after signing', () => {
    const file = crx(store, zip)
    const last = file.length - 1
    file[last] = (file[last] as number) ^ 1
    expect(crxSignedBy(file, der(store.publicKey))).toBe(false)
  })

  test('rejects a file that is not a CRX3', () => {
    expect(crxSignedBy(new Uint8Array(zip), der(store.publicKey))).toBe(false)
  })
})

test('the committed public key is a 2048-bit RSA key', () => {
  const pem = readFileSync(
    join(import.meta.dir, '../.config/cws-signing-key.pub.pem'),
    'utf8'
  )
  // A 2048-bit RSA SubjectPublicKeyInfo is 294 bytes of DER.
  expect(publicKeyDer(pem).length).toBe(294)
})
