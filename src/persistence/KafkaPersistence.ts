/**
 * Kafka persistence handler for drain-ts.
 *
 * Maps 1:1 to Python `KafkaPersistence` class (drain3/kafka_persistence.py).
 *
 * Stores Drain state snapshots to a Kafka topic. On load, reads the last
 * message from the topic. Requires `kafkajs` as an optional peer dependency.
 *
 * ```bash
 * npm install kafkajs
 * ```
 *
 * @module KafkaPersistence
 */

import type { PersistenceHandler } from "./PersistenceHandler.js";

/**
 * Kafka-backed state persistence.
 *
 * State is saved as the latest message on a Kafka topic.
 * On load, the consumer reads the last message from offset end-1.
 */
export class KafkaPersistence implements PersistenceHandler {
  readonly name = "kafka";
  private readonly _topic: string;
  private readonly _config: Record<string, unknown>;
  private readonly _snapshotPollTimeoutMs: number;

  /**
   * @param topic - Kafka topic for state snapshot messages
   * @param kafkaConfig - kafkajs Kafka config (brokers, clientId, ssl, etc.)
   * @param snapshotPollTimeoutMs - Max time to wait for snapshot on restore (default: 60000ms)
   */
  constructor(
    topic: string,
    kafkaConfig: Record<string, unknown>,
    snapshotPollTimeoutMs: number = 60000,
  ) {
    this._topic = topic;
    this._config = kafkaConfig;
    this._snapshotPollTimeoutMs = snapshotPollTimeoutMs;
  }

  /**
   * Saves state as a message to the Kafka topic.
   *
   * Python: KafkaPersistence.save_state() — producer.send(topic, value=state)
   */
  async saveState(state: Uint8Array): Promise<void> {
    const { Kafka } = require("kafkajs");
    const kafka = new Kafka(this._config);
    const producer = kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic: this._topic,
        messages: [{ value: Buffer.from(state) }],
      });
    } finally {
      await producer.disconnect();
    }
  }

  /**
   * Loads the latest state snapshot from Kafka.
   *
   * Python: KafkaPersistence.load_state() — consumer.seek(end_offset - 1), poll
   *
   * @returns State buffer or null if no messages exist on the topic
   */
  async loadState(): Promise<Uint8Array | null> {
    const { Kafka } = require("kafkajs");
    const kafka = new Kafka(this._config);
    const consumer = kafka.consumer({ groupId: `drain-ts-restore-${Date.now()}` });

    await consumer.connect();
    await consumer.subscribe({ topic: this._topic, fromBeginning: false });

    try {
      const messages: Array<{ value: Buffer | null }> = [];
      await consumer.run({
        eachMessage: async ({ message }: { message: { value: Buffer | null } }) => {
          messages.push({ value: message.value });
        },
      });

      const startTime = Date.now();
      while (messages.length === 0 && Date.now() - startTime < this._snapshotPollTimeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (messages.length === 0) return null;
      return messages[messages.length - 1]?.value
        ? new Uint8Array(messages[messages.length - 1]!.value!)
        : null;
    } finally {
      await consumer.disconnect();
    }
  }
}
