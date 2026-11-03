#!/usr/bin/env bun
/**
 * Uploads a signed CRX (`bun crx`) to the Chrome Web Store item and submits it for review, through
 * the Web Store API v2 (DECISIONS.md D20). `wxt submit` is not used: it uploads a zip without the
 * raw-upload headers a Verified CRX upload needs (D18), and a script is smaller than a dependency.
 *
 *   CWS_ACCESS_TOKEN=… CWS_PUBLISHER_ID=… bun scripts/upload-cws.ts .output/audible-ex-0.2.0-chrome.crx
 *   … --dry-run   # checks the signature, the credentials and the item's state; uploads nothing
 *
 * The token is an OAuth access token for the `chromewebstore` scope; the release workflow gets it
 * from Google through GitHub's OIDC token (no stored credential). Before anything is sent the CRX
 * is checked against the committed public key, so a package signed with another key stops here.
 */
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { crxSignedBy, publicKeyDer } from './pack-crx'

const ROOT = join(import.meta.dir, '..')
const PUBLIC_KEY = join(ROOT, '.config/cws-signing-key.pub.pem')
/** The store item (docs/STORE-LISTING.md); later releases update it, never create another. */
export const ITEM_ID = 'kmmnfidbflcgfcbifjfakgnjppoflffo'
const API = 'https://chromewebstore.googleapis.com'

type Json = Record<string, unknown>

export interface UploadOptions {
  crx: Uint8Array
  /** The file name sent with the upload, such as `audible-ex-0.2.0-chrome.crx`. */
  fileName: string
  publisherId: string
  token: string
  dryRun?: boolean
  /** Replaced in tests. */
  fetch?: typeof fetch
  /** Seconds between status checks while the store processes the upload. */
  pollSeconds?: number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

/** Uploads the CRX and submits it; throws on the first thing the store refuses. */
export async function uploadToStore(options: UploadOptions): Promise<void> {
  const {
    crx,
    fileName,
    publisherId,
    token,
    dryRun = false,
    fetch: send = fetch,
    pollSeconds = 5,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    log = console.log,
  } = options
  const name = `publishers/${publisherId}/items/${ITEM_ID}`

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    extra: RequestInit = {}
  ): Promise<Json> => {
    const response = await send(url, {
      method,
      ...extra,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-goog-api-version': '2',
        ...extra.headers,
      },
    })
    const text = await response.text()
    if (!response.ok)
      throw new Error(`${method} ${url}: ${response.status} ${text.trim()}`)
    return text ? (JSON.parse(text) as Json) : {}
  }
  const fetchStatus = () => call('GET', `${API}/v2/${name}:fetchStatus`)
  const stateOf = (status: Json, key: string): unknown =>
    (status[key] as Json | undefined)?.state

  const status = await fetchStatus()
  log(
    `Credentials accepted; the item is ${String(stateOf(status, 'publishedItemRevisionStatus') ?? 'not published')}.`
  )
  if (stateOf(status, 'submittedItemRevisionStatus') === 'PENDING_REVIEW')
    throw new Error(
      'A submission is already in review. Cancel it in the dashboard (Package tab), or wait for it, then run the release again.'
    )
  if (dryRun) {
    log('Dry run: nothing uploaded.')
    return
  }

  log(`Uploading ${fileName} (${(crx.length / 1024).toFixed(1)} KB)…`)
  let upload = await call('POST', `${API}/upload/v2/${name}:upload`, {
    headers: {
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': fileName,
    },
    body: crx as BodyInit,
  })
  // Processing can outlast the request; the store reports it through the item's status.
  for (let wait = 0; upload.uploadState === 'UPLOAD_IN_PROGRESS'; wait++) {
    if (wait === 24)
      throw new Error('The upload was still processing after 2 minutes')
    await sleep(pollSeconds * 1000)
    upload = { uploadState: (await fetchStatus()).lastAsyncUploadState }
  }
  if (upload.uploadState !== 'SUCCEEDED')
    throw new Error(
      `The store did not accept the upload: ${JSON.stringify(upload)}`
    )

  log('Submitting for review…')
  const published = await call('POST', `${API}/v2/${name}:publish`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  })
  const warnings =
    (published.warningInfo as { warnings?: Json[] } | undefined)?.warnings ?? []
  for (const warning of warnings)
    log(`Warning: ${String(warning.reason)}: ${String(warning.description)}`)
  log(`Submitted; the store reports ${String(published.state ?? 'no state')}.`)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const path = args.find(arg => !arg.startsWith('--'))
  if (!path)
    throw new Error('Usage: bun scripts/upload-cws.ts [--dry-run] <file.crx>')
  const token = process.env.CWS_ACCESS_TOKEN
  const publisherId = process.env.CWS_PUBLISHER_ID
  if (!token || !publisherId)
    throw new Error('Set CWS_ACCESS_TOKEN and CWS_PUBLISHER_ID')

  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    .version as string
  const fileName = basename(path)
  if (fileName !== `audible-ex-${version}-chrome.crx`)
    throw new Error(
      `${fileName} is not the CRX of package.json's version ${version}`
    )
  const crx = new Uint8Array(readFileSync(path))
  if (!crxSignedBy(crx, publicKeyDer(readFileSync(PUBLIC_KEY, 'utf8'))))
    throw new Error(
      `${path} is not signed by the store's signing key (${PUBLIC_KEY})`
    )

  await uploadToStore({ crx, fileName, publisherId, token, dryRun })
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
