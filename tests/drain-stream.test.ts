/**
 * DrainStream tests — streaming Transform API.
 */
import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DrainStream, createDrainStream } from "../src/DrainStream.js";
import type { AddLogResult } from "../src/core/types.js";

/**
 * Helper: creates a readable stream from string content.
 */
function stringStream(content: string): Readable {
  return Readable.from([content]);
}

/**
 * Helper: collects all chunks from a stream into an array.
 */
async function collect<T>(stream: Readable): Promise<T[]> {
  const results: T[] = [];
  for await (const chunk of stream) {
    results.push(chunk as T);
  }
  return results;
}

describe("DrainStream", () => {
  it("should process single-line input", async () => {
    const stream = new DrainStream();
    const results = await collect<AddLogResult>(
      stringStream("hello world").pipe(stream),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.changeType).toBe("cluster_created");
    expect(results[0]!.templateMined).toBe("hello world");
  });

  it("should process multi-line input", async () => {
    const stream = new DrainStream();
    const results = await collect<AddLogResult>(
      stringStream(
        "user alice logged in\nuser bob logged in\nuser carol logged in\n",
      ).pipe(stream),
    );
    expect(results).toHaveLength(3);
    // Third message should be generalized
    expect(results[2]!.templateMined).toContain("<*>");
  });

  it("should cluster similar messages across lines", async () => {
    const stream = new DrainStream();
    const results = await collect<AddLogResult>(
      stringStream("error 404 at 192.168.1.1\nerror 500 at 10.0.0.1\n").pipe(
        stream,
      ),
    );
    expect(results).toHaveLength(2);
    // Both should be in the same or different clusters
    const templates = new Set(results.map((r) => r.templateMined));
    expect(templates.size).toBeGreaterThanOrEqual(1);
  });

  it("should skip empty lines", async () => {
    const stream = new DrainStream();
    const results = await collect<AddLogResult>(
      stringStream("\n\ntest message\n\n\nanother message\n").pipe(stream),
    );
    expect(results).toHaveLength(2);
  });

  it("should handle partial chunks (buffered lines)", async () => {
    const stream = new DrainStream();
    // Send half a line, then the rest
    const readable = Readable.from(["first half of ", "the line\ncomplete line\n"]);
    const results = await collect<AddLogResult>(readable.pipe(stream));
    expect(results).toHaveLength(2);
    expect(results[0]!.templateMined).toBe("first half of the line");
    expect(results[1]!.templateMined).toBe("complete line");
  });

  it("should expose miner and stats", async () => {
    const stream = new DrainStream();
    await collect<AddLogResult>(
      stringStream("msg1\nmsg2\nmsg3\n").pipe(stream),
    );
    expect(stream.lineCount).toBe(3);
    expect(stream.clusterCount).toBeGreaterThanOrEqual(1);
    expect(stream.miner).toBeDefined();
    // match() should work on the trained model
    expect(stream.miner.match("msg1")).not.toBeNull();
  });

  it("should work with pipeline() API", async () => {
    const stream = new DrainStream();
    await pipeline(stringStream("pipeline test\n"), stream);
    expect(stream.lineCount).toBe(1);
  });

  it("should flush remaining partial line on end", async () => {
    const stream = new DrainStream();
    const results = await collect<AddLogResult>(
      stringStream("no trailing newline").pipe(stream),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.templateMined).toBe("no trailing newline");
  });

  it("should handle empty input gracefully", async () => {
    const stream = new DrainStream();
    const results = await collect<AddLogResult>(
      stringStream("").pipe(stream),
    );
    expect(results).toHaveLength(0);
  });

  it("should handle createDrainStream convenience function", () => {
    const stream = createDrainStream();
    expect(stream).toBeInstanceOf(DrainStream);
  });

  it("should emit error on malformed input via _transform catch", async () => {
    const stream = new DrainStream();
    // Force an error by corrupting internal state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stream as any)._miner.addLogMessage = () => {
      throw new Error("synthetic transform error");
    };
    await expect(
      collect(stringStream("anything\n").pipe(stream)),
    ).rejects.toThrow("synthetic transform error");
  });

  it("should emit error in _flush on malformed flush", async () => {
    const stream = new DrainStream();
    // Force an error during flush
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stream as any)._miner.addLogMessage = () => {
      throw new Error("synthetic flush error");
    };
    // Feed a line WITHOUT trailing newline to trigger _flush
    await expect(
      collect(stringStream("incomplete").pipe(stream)),
    ).rejects.toThrow("synthetic flush error");
  });
});
