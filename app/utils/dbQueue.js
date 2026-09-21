/**
 * Hàng đợi thao tác DB — giới hạn số query chạy đồng thời, phần còn lại xếp hàng.
 */
class DbQueue {
  constructor(concurrency = 10) {
    this.concurrency = Math.max(1, concurrency);
    this.running = 0;
    this.queue = [];
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.running += 1;
      Promise.resolve()
        .then(() => job.fn())
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running -= 1;
          this._pump();
        });
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      concurrency: this.concurrency,
    };
  }
}

const concurrency = parseInt(process.env.DB_QUEUE_CONCURRENCY, 10) || 12;
const dbQueue = new DbQueue(concurrency);

module.exports = { dbQueue, DbQueue };
