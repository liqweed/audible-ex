import { describe, expect, test } from 'bun:test'
import { ITEM_ID, uploadToStore } from './upload-cws'

const item = `publishers/pub/items/${ITEM_ID}`

/** A fake store: answers by "METHOD path", records every request. */
function fakeStore(answers: Record<string, unknown[] | unknown>) {
  const requests: { key: string; init: RequestInit }[] = []
  const queues = new Map(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : [value],
    ])
  )
  const fetch = (async (url: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(url).pathname}`
    requests.push({ key, init })
    const queue = queues.get(key)
    if (!queue?.length) return new Response('no such route', { status: 404 })
    const answer = queue.length > 1 ? queue.shift() : queue[0]
    return answer instanceof Response
      ? answer
      : new Response(JSON.stringify(answer))
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

const run = (store: ReturnType<typeof fakeStore>, dryRun = false) => {
  const log: string[] = []
  const done = uploadToStore({
    crx: new Uint8Array([1, 2, 3]),
    fileName: 'audible-ex-0.2.0-chrome.crx',
    publisherId: 'pub',
    token: 'secret-token',
    dryRun,
    fetch: store.fetch,
    sleep: async () => {},
    log: message => log.push(message),
  })
  return { done, log }
}

const status = `GET /v2/${item}:fetchStatus`
const upload = `POST /upload/v2/${item}:upload`
const publish = `POST /v2/${item}:publish`

describe('uploadToStore', () => {
  test('uploads the CRX raw, then submits it for review', async () => {
    const store = fakeStore({
      [status]: { publishedItemRevisionStatus: { state: 'PUBLISHED' } },
      [upload]: { uploadState: 'SUCCEEDED' },
      [publish]: { state: 'PENDING_REVIEW' },
    })
    const { done, log } = run(store)
    await done
    expect(store.requests.map(r => r.key)).toEqual([status, upload, publish])
    const sent = store.requests[1]?.init
    expect(sent?.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': 'audible-ex-0.2.0-chrome.crx',
    })
    expect(sent?.body).toEqual(new Uint8Array([1, 2, 3]))
    expect(JSON.parse(String(store.requests[2]?.init.body))).toEqual({
      publishType: 'DEFAULT_PUBLISH',
    })
    expect(log.join('\n')).not.toContain('secret-token')
  })

  test('a dry run checks the credentials and uploads nothing', async () => {
    const store = fakeStore({ [status]: {} })
    await run(store, true).done
    expect(store.requests.map(r => r.key)).toEqual([status])
  })

  test('stops when a submission is already in review', async () => {
    const store = fakeStore({
      [status]: { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } },
    })
    await expect(run(store).done).rejects.toThrow('already in review')
    expect(store.requests).toHaveLength(1)
  })

  test('waits while the store processes the upload', async () => {
    const store = fakeStore({
      [status]: [
        {},
        { lastAsyncUploadState: 'UPLOAD_IN_PROGRESS' },
        { lastAsyncUploadState: 'SUCCEEDED' },
      ],
      [upload]: { uploadState: 'UPLOAD_IN_PROGRESS' },
      [publish]: {},
    })
    await run(store).done
    expect(store.requests.map(r => r.key)).toEqual([
      status,
      upload,
      status,
      status,
      publish,
    ])
  })

  test('does not submit an upload the store refused', async () => {
    const store = fakeStore({
      [status]: {},
      [upload]: { uploadState: 'FAILED' },
    })
    await expect(run(store).done).rejects.toThrow('did not accept the upload')
    expect(store.requests.map(r => r.key)).not.toContain(publish)
  })

  test('reports an HTTP error with its status', async () => {
    const store = fakeStore({
      [status]: new Response('{"error":"denied"}', { status: 403 }),
    })
    await expect(run(store).done).rejects.toThrow('403')
  })
})
