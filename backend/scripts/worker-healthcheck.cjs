const { Queue } = require('bullmq');
const IORedis = require('ioredis');

async function check() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');

  const connection = new IORedis(url, {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  const queue = new Queue('notifications', { connection });
  try {
    const workers = await queue.getWorkers();
    if (workers.length === 0) throw new Error('No notification worker is registered');
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

check().catch(() => {
  process.exitCode = 1;
});
