/**
 * Runs read-modify-write updates of one storage item one after another. `storage` has no
 * transactions, so two updates started together would both read the old value and the later write
 * would erase the earlier one. This closes that gap inside one script; two tabs writing within the
 * same few milliseconds can still lose a write, which a user changing settings by hand does not do.
 */
export function serial(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return job => {
    const run = tail.then(job, job)
    // A failed update must not stop the ones queued behind it.
    tail = run.catch(() => undefined)
    return run
  }
}
