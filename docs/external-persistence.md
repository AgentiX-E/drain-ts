# External Persistence Implementation Guide

drain-ts defines a **framework-agnostic** `PersistenceHandler` interface for
state persistence. The core package ships with two zero-dependency built-in
implementations (`FilePersistence` and `MemoryPersistence`). For other storage
backends (Redis, Kafka, PostgreSQL, S3, etc.), you implement the interface in
your own project.

## The PersistenceHandler Interface

```typescript
export interface PersistenceHandler {
  saveState(state: Uint8Array): void | Promise<void>;
  loadState(): Uint8Array | null | Promise<Uint8Array | null>;
}
```

Only two methods. ~15 lines of code per backend.

## Quick Start: Redis Persistence

Install `ioredis` in your project (NOT in drain-ts):

```bash
pnpm add ioredis
```

Create the adapter:

```typescript
// src/persistence/RedisPersistence.ts
import type { PersistenceHandler } from "@agentix-e/drain-ts";
import type { Redis } from "ioredis";

export class RedisPersistence implements PersistenceHandler {
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
  ) {}

  async saveState(state: Uint8Array): Promise<void> {
    await this.redis.set(this.key, Buffer.from(state));
  }

  async loadState(): Promise<Uint8Array | null> {
    const data = await this.redis.getBuffer(this.key);
    return data ? new Uint8Array(data) : null;
  }
}
```

Usage:

```typescript
import Redis from "ioredis";
import { TemplateMiner } from "@agentix-e/drain-ts";

const redis = new Redis({ host: "localhost", port: 6379 });
const handler = new RedisPersistence(redis, "drain-ts:snapshot");

const miner = new TemplateMiner({ persistenceHandler: handler });
// State is automatically persisted to Redis
```

## Quick Start: Kafka Persistence

Install `kafkajs`:

```bash
pnpm add kafkajs
```

```typescript
// src/persistence/KafkaPersistence.ts
import type { PersistenceHandler } from "@agentix-e/drain-ts";
import type { Kafka, Producer, Consumer } from "kafkajs";

export class KafkaPersistence implements PersistenceHandler {
  private producer: Producer;
  private consumer: Consumer;
  private lastMessage: Buffer | null = null;

  constructor(
    kafka: Kafka,
    private readonly topic: string,
  ) {
    this.producer = kafka.producer();
    this.consumer = kafka.consumer({ groupId: "drain-ts-snapshot" });
  }

  async saveState(state: Uint8Array): Promise<void> {
    await this.producer.connect();
    await this.producer.send({
      topic: this.topic,
      messages: [{ value: Buffer.from(state) }],
    });
    await this.producer.disconnect();
  }

  async loadState(): Promise<Uint8Array | null> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.consumer.disconnect();
        resolve(this.lastMessage ? new Uint8Array(this.lastMessage) : null);
      }, 5000);

      this.consumer.run({
        eachMessage: async ({ message }) => {
          if (message.value) {
            this.lastMessage = Buffer.from(message.value);
          }
          clearTimeout(timeout);
          await this.consumer.disconnect();
          resolve(this.lastMessage ? new Uint8Array(this.lastMessage) : null);
        },
      });
    });
  }
}
```

## Quick Start: S3 Persistence

```typescript
import type { PersistenceHandler } from "@agentix-e/drain-ts";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

export class S3Persistence implements PersistenceHandler {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async saveState(state: Uint8Array): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
      Body: state,
    }));
  }

  async loadState(): Promise<Uint8Array | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
      }));
      const bytes = await response.Body?.transformToByteArray();
      return bytes ?? null;
    } catch {
      return null;
    }
  }
}
```

## Design Principles

1. **drain-ts owns the contract, you own the implementation.** The core package
   never imports `ioredis`, `kafkajs`, or any other storage client.
2. **Zero mandatory peer dependencies.** `pnpm add @agentix-e/drain-ts` installs
   nothing beyond the package itself.
3. **Uint8Array, not Buffer.** The interface uses the Web standard `Uint8Array`
   for cross-runtime compatibility (Node, Deno, Bun, browsers).
4. **Sync or async.** Both `saveState` and `loadState` support sync and async
   implementations. TemplateMiner handles both.

## Snapshot Format

The state passed to `saveState` is a UTF-8 JSON string:

```json
{
  "version": "0.1.0",
  "clusters": [
    {
      "cluster_id": 1,
      "log_template_tokens": ["user", "<*>", "logged", "in"],
      "size": 42
    }
  ]
}
```

You can safely store this as-is, or compress/encrypt it before storage.
