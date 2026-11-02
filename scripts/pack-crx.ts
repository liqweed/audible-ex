#!/usr/bin/env bun
/**
 * Packs the built extension (`.output/chrome-mv3`) into a CRX signed with the Chrome Web Store
 * signing key, for Verified CRX uploads: once opted in, the store rejects any package not signed
 * with this key (DECISIONS.md D18, docs/STORE-LISTING.md). Run after `bun run build`:
 *
 *   bun crx                      # the key from 1Password, through the `op` CLI
 *   bun crx --key path/to/key.pem
 *
 * The private key lives only in 1Password; it is copied into a private temporary directory for the
 * length of the run and deleted after. Before packing, the key is checked against the committed
 * public key (`.config/cws-signing-key.pub.pem`); after, the CRX's signature is verified against it,
 * so a wrong key or a broken package fails here and not in the store. Chrome does the packing (its
 * `--pack-extension`), from Playwright's bundled Chromium, which `bun e2e` already needs.
 */
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const BUILD = join(ROOT, '.output/chrome-mv3')
const PUBLIC_KEY = join(ROOT, '.config/cws-signing-key.pub.pem')
/** The 1Password document holding the private key (Private vault). */
const OP_VAULT = 'Private'
const OP_ITEM = 'Book Ratings for Audible — Chrome Web Store signing key'

/** The DER (SubjectPublicKeyInfo) form of a PEM key, public or private. */
export function publicKeyDer(pem: string): Uint8Array {
  const key = pem.includes('PRIVATE KEY')
    ? createPublicKey(createPrivateKey(pem))
    : createPublicKey(pem)
  return new Uint8Array(key.export({ type: 'spki', format: 'der' }))
}

/** Reads one protobuf varint at `at`; returns the value and the offset after it. */
function varint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0
  let shift = 0
  for (let i = at; i < bytes.length; i++) {
    const byte = bytes[i] as number
    value += (byte & 0x7f) * 2 ** shift
    if (byte < 0x80) return [value, i + 1]
    shift += 7
  }
  throw new Error('truncated varint')
}

/** The length-delimited fields of a protobuf message, as [field number, bytes] pairs. */
function fields(message: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = []
  let at = 0
  while (at < message.length) {
    const [tag, afterTag] = varint(message, at)
    if ((tag & 7) !== 2) throw new Error(`unexpected wire type ${tag & 7}`)
    const [length, start] = varint(message, afterTag)
    out.push([Math.floor(tag / 8), message.subarray(start, start + length)])
    at = start + length
  }
  return out
}

const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true)

/**
 * True when `crx` is a CRX3 file with a valid SHA-256/RSA proof by the key `spki` (DER). CRX3: the
 * magic `Cr24`, version 3, the header's length, the `CrxFileHeader` protobuf (field 2: RSA proofs of
 * `public_key` = 1 and `signature` = 2; field 10000: `signed_header_data`), then the zip. Each proof
 * signs `CRX3 SignedData\0`, the signed header data's length (uint32 LE), that data and the zip.
 */
export function crxSignedBy(crx: Uint8Array, spki: Uint8Array): boolean {
  if (
    crx.length < 12 ||
    new TextDecoder().decode(crx.subarray(0, 4)) !== 'Cr24'
  )
    return false
  if (u32(crx, 4) !== 3) return false
  const headerEnd = 12 + u32(crx, 8)
  const header = fields(crx.subarray(12, headerEnd))
  const signedData = header.find(([field]) => field === 10000)?.[1]
  if (!signedData) return false
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, signedData.length, true)
  const message = Buffer.concat([
    Buffer.from('CRX3 SignedData\0'),
    length,
    signedData,
    crx.subarray(headerEnd),
  ])
  return header
    .filter(([field]) => field === 2)
    .some(([, proof]) => {
      const parts = fields(proof)
      const key = parts.find(([field]) => field === 1)?.[1]
      const signature = parts.find(([field]) => field === 2)?.[1]
      if (!key || !signature || !Buffer.from(key).equals(Buffer.from(spki)))
        return false
      const publicKey = createPublicKey({
        key: Buffer.from(key),
        format: 'der',
        type: 'spki',
      })
      return verify('sha256', message, publicKey, signature)
    })
}

function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0)
    throw new Error(
      `${cmd[0]} failed (${result.exitCode}): ${result.stderr.toString().trim()}`
    )
}

async function main() {
  const keyArg = process.argv.indexOf('--key')
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    .version as string
  const manifest = join(BUILD, 'manifest.json')
  if (!existsSync(manifest))
    throw new Error('No build in .output/chrome-mv3: run `bun run build` first')
  const built = JSON.parse(readFileSync(manifest, 'utf8')).version as string
  if (built !== version)
    throw new Error(
      `The build is ${built}, package.json is ${version}: run \`bun run build\` again`
    )

  const temp = mkdtempSync(join(tmpdir(), 'cws-key-'))
  try {
    let keyPath: string
    if (keyArg > 0) {
      keyPath = process.argv[keyArg + 1] ?? ''
    } else {
      keyPath = join(temp, 'key.pem')
      run([
        'op',
        'document',
        'get',
        OP_ITEM,
        '--vault',
        OP_VAULT,
        '--out-file',
        keyPath,
      ])
    }
    const expected = publicKeyDer(readFileSync(PUBLIC_KEY, 'utf8'))
    if (
      !Buffer.from(publicKeyDer(readFileSync(keyPath, 'utf8'))).equals(
        Buffer.from(expected)
      )
    )
      throw new Error(
        `The key does not match ${PUBLIC_KEY}: is it the store's signing key?`
      )

    const { chromium } = await import('playwright')
    const packed = `${BUILD}.crx`
    rmSync(packed, { force: true })
    run([
      chromium.executablePath(),
      `--pack-extension=${BUILD}`,
      `--pack-extension-key=${keyPath}`,
      '--no-message-box',
    ])
    const crx = new Uint8Array(readFileSync(packed))
    if (!crxSignedBy(crx, expected))
      throw new Error(`${packed} is not signed by the store's signing key`)
    const out = join(ROOT, `.output/audible-ex-${version}-chrome.crx`)
    renameSync(packed, out)
    console.log(
      `${out}: ${(crx.length / 1024).toFixed(1)} KB, signed by the store's key`
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
