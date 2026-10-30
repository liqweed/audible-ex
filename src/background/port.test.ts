import { describe, expect, test } from 'bun:test'
import { buffered, type PortLike } from './port'

/** A port whose events a test fires by hand. */
const rawPort = () => {
  const messageListeners: Array<(message: unknown) => void> = []
  const disconnectListeners: Array<() => void> = []
  const sent: unknown[] = []
  const port: PortLike = {
    name: 'agx',
    postMessage: message => sent.push(message),
    onMessage: { addListener: l => messageListeners.push(l) },
    onDisconnect: { addListener: l => disconnectListeners.push(l) },
  }
  return {
    port,
    sent,
    emit: (message: unknown) => {
      for (const l of messageListeners) l(message)
    },
    disconnect: () => {
      for (const l of disconnectListeners) l()
    },
  }
}

describe('buffered', () => {
  test('keeps what the port said before a listener was added, in order', () => {
    const raw = rawPort()
    const port = buffered(raw.port)
    raw.emit('one')
    raw.emit('two')
    const heard: unknown[] = []
    port.onMessage.addListener(message => heard.push(message))
    expect(heard).toEqual(['one', 'two'])
    raw.emit('three')
    expect(heard).toEqual(['one', 'two', 'three'])
  })

  test('tells a listener added after the disconnect, after the messages', () => {
    const raw = rawPort()
    const port = buffered(raw.port)
    raw.emit('last words')
    raw.disconnect()
    const events: string[] = []
    port.onMessage.addListener(message => events.push(String(message)))
    port.onDisconnect.addListener(() => events.push('disconnect'))
    expect(events).toEqual(['last words', 'disconnect'])
  })

  test('tells a listener added before the disconnect when it happens', () => {
    const raw = rawPort()
    const port = buffered(raw.port)
    let gone = false
    port.onDisconnect.addListener(() => {
      gone = true
    })
    expect(gone).toBe(false)
    raw.disconnect()
    expect(gone).toBe(true)
  })

  test('posts through to the port and keeps its name', () => {
    const raw = rawPort()
    const port = buffered(raw.port)
    port.postMessage({ hello: 1 })
    expect(raw.sent).toEqual([{ hello: 1 }])
    expect(port.name).toBe('agx')
  })
})
