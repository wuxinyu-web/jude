/* All learning mutations and sync application share one worker transaction queue. */
var YTD_DATA_LOCK = (() => {
  let tail = Promise.resolve();
  return fn => {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  };
})();
