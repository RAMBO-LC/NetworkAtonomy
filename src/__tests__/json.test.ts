/**
 * Tests for JSON serialization and schema validation.
 */

import { describe, it, expect } from "vitest";
import {
  serializeResults,
  parseResults,
  isAggregatedResults,
  loadOutputSchema,
} from "../json";
import type { AggregatedResults, StageStats } from "../runner";

function createStageStats(overrides: Partial<StageStats> = {}): StageStats {
  return {
    medianMs: 25,
    minMs: 10,
    maxMs: 50,
    ...overrides,
  };
}

function createAggregatedResults(overrides: Partial<AggregatedResults> = {}): AggregatedResults {
  const defaultStages = {
    dns: createStageStats(),
    tcp: createStageStats(),
    tls: createStageStats(),
    ttfb: createStageStats(),
    body: createStageStats(),
  };

  return {
    stages: defaultStages,
    total: createStageStats({ medianMs: 100, minMs: 80, maxMs: 150 }),
    runsRequested: 5,
    runsSuccessful: 5,
    runsFailed: 0,
    url: "https://example.com",
    ip: "93.184.216.34",
    family: "IPv4",
    statusCode: 200,
    warnings: [],
    ...overrides,
  };
}

describe("json - serializeResults", () => {
  it("serializes AggregatedResults to JSON string", () => {
    const results = createAggregatedResults();
    const json = serializeResults(results);

    expect(typeof json).toBe("string");
    expect(json).toContain('"runsRequested": 5');
    expect(json).toContain('"url": "https://example.com"');
    expect(json).toContain('"family": "IPv4"');
  });

  it("produces valid JSON that can be parsed", () => {
    const results = createAggregatedResults();
    const json = serializeResults(results);

    const parsed = JSON.parse(json);
    expect(parsed.runsRequested).toBe(5);
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.family).toBe("IPv4");
  });

  it("includes all stages with median/min/max", () => {
    const results = createAggregatedResults();
    const json = serializeResults(results);
    const parsed = JSON.parse(json);

    expect(parsed.stages.dns).toEqual({ medianMs: 25, minMs: 10, maxMs: 50 });
    expect(parsed.stages.tcp).toEqual({ medianMs: 25, minMs: 10, maxMs: 50 });
    expect(parsed.stages.tls).toEqual({ medianMs: 25, minMs: 10, maxMs: 50 });
    expect(parsed.stages.ttfb).toEqual({ medianMs: 25, minMs: 10, maxMs: 50 });
    expect(parsed.stages.body).toEqual({ medianMs: 25, minMs: 10, maxMs: 50 });
  });

  it("includes total stats", () => {
    const results = createAggregatedResults();
    const json = serializeResults(results);
    const parsed = JSON.parse(json);

    expect(parsed.total).toEqual({ medianMs: 100, minMs: 80, maxMs: 150 });
  });

  it("includes runs counts", () => {
    const results = createAggregatedResults({ runsRequested: 10, runsSuccessful: 8, runsFailed: 2 });
    const json = serializeResults(results);
    const parsed = JSON.parse(json);

    expect(parsed.runsRequested).toBe(10);
    expect(parsed.runsSuccessful).toBe(8);
    expect(parsed.runsFailed).toBe(2);
  });

  it("includes warnings array", () => {
    const results = createAggregatedResults({ warnings: ["Warning: 2 of 10 runs failed."] });
    const json = serializeResults(results);
    const parsed = JSON.parse(json);

    expect(parsed.warnings).toEqual(["Warning: 2 of 10 runs failed."]);
  });

  it("supports IPv6 family", () => {
    const results = createAggregatedResults({
      ip: "2606:2800:220:1:248:1893:25c8:1946",
      family: "IPv6",
    });
    const json = serializeResults(results);
    const parsed = JSON.parse(json);

    expect(parsed.ip).toBe("2606:2800:220:1:248:1893:25c8:1946");
    expect(parsed.family).toBe("IPv6");
  });

  it("supports compact output without pretty printing", () => {
    const results = createAggregatedResults();
    const json = serializeResults(results, { pretty: false });

    expect(json).not.toContain("\n");
    expect(json).not.toContain("  ");
  });
});

describe("json - parseResults", () => {
  it("parses valid JSON string to AggregatedResults", () => {
    const results = createAggregatedResults();
    const json = serializeResults(results);

    const parsed = parseResults(json);
    expect(parsed).toEqual(results);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseResults("{ invalid json }")).toThrow("Invalid JSON");
  });

  it("throws on JSON missing required fields", () => {
    const invalidJson = JSON.stringify({ runsRequested: 5 });
    expect(() => parseResults(invalidJson)).toThrow("does not match AggregatedResults schema");
  });

  it("throws on JSON with wrong types", () => {
    const invalid = createAggregatedResults();
    (invalid as any).runsRequested = "five"; // wrong type
    const json = JSON.stringify(invalid);
    expect(() => parseResults(json)).toThrow("does not match AggregatedResults schema");
  });

  it("throws on invalid family value", () => {
    const invalid = createAggregatedResults({ family: "IPv7" as any });
    const json = JSON.stringify(invalid);
    expect(() => parseResults(json)).toThrow("does not match AggregatedResults schema");
  });

  it("throws on missing stage stats", () => {
    const invalid = createAggregatedResults();
    delete (invalid as any).stages.dns;
    const json = JSON.stringify(invalid);
    expect(() => parseResults(json)).toThrow("does not match AggregatedResults schema");
  });

  it("throws on negative timing values", () => {
    const invalid = createAggregatedResults({
      stages: {
        ...createAggregatedResults().stages,
        dns: { medianMs: -1, minMs: 0, maxMs: 10 },
      },
    });
    const json = JSON.stringify(invalid);
    expect(() => parseResults(json)).toThrow("does not match AggregatedResults schema");
  });
});

describe("json - isAggregatedResults", () => {
  it("returns true for valid AggregatedResults", () => {
    const results = createAggregatedResults();
    expect(isAggregatedResults(results)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isAggregatedResults(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAggregatedResults(undefined)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isAggregatedResults("string")).toBe(false);
    expect(isAggregatedResults(123)).toBe(false);
    expect(isAggregatedResults(true)).toBe(false);
  });

  it("returns false for object missing required fields", () => {
    expect(isAggregatedResults({})).toBe(false);
    expect(isAggregatedResults({ runsRequested: 5 })).toBe(false);
  });

  it("returns false for invalid family", () => {
    const invalid = createAggregatedResults({ family: "IPv7" as any });
    expect(isAggregatedResults(invalid)).toBe(false);
  });

  it("returns false for non-array warnings", () => {
    const invalid = createAggregatedResults({ warnings: "not an array" as any });
    expect(isAggregatedResults(invalid)).toBe(false);
  });

  it("returns false for non-string warning items", () => {
    const invalid = createAggregatedResults({ warnings: [123] as any });
    expect(isAggregatedResults(invalid)).toBe(false);
  });

  it("returns false for missing stage", () => {
    const invalid = createAggregatedResults();
    delete (invalid as any).stages.dns;
    expect(isAggregatedResults(invalid)).toBe(false);
  });

  it("returns false for invalid stage stats", () => {
    const invalid = createAggregatedResults({
      stages: {
        ...createAggregatedResults().stages,
        dns: { medianMs: "fast" as any, minMs: 0, maxMs: 10 },
      },
    });
    expect(isAggregatedResults(invalid)).toBe(false);
  });

  it("returns false for negative timing values", () => {
    const invalid = createAggregatedResults({
      stages: {
        ...createAggregatedResults().stages,
        dns: { medianMs: -1, minMs: 0, maxMs: 10 },
      },
    });
    expect(isAggregatedResults(invalid)).toBe(false);
  });
});

describe("json - schema validation", () => {
  it("loads output schema successfully", async () => {
    const schema = await loadOutputSchema();
    expect(schema).toBeDefined();
    expect(typeof schema).toBe("object");
    expect((schema as any).title).toBe("Network Atonomy Aggregated Results");
  });

  it("schema has required top-level properties", async () => {
    const schema = await loadOutputSchema();
    const props = (schema as any).properties;

    expect(props.stages).toBeDefined();
    expect(props.total).toBeDefined();
    expect(props.runsRequested).toBeDefined();
    expect(props.runsSuccessful).toBeDefined();
    expect(props.runsFailed).toBeDefined();
    expect(props.url).toBeDefined();
    expect(props.ip).toBeDefined();
    expect(props.family).toBeDefined();
    expect(props.warnings).toBeDefined();
  });

  it("schema defines all five stages", async () => {
    const schema = await loadOutputSchema();
    const stagesProps = (schema as any).properties.stages.properties;

    expect(stagesProps.dns).toBeDefined();
    expect(stagesProps.tcp).toBeDefined();
    expect(stagesProps.tls).toBeDefined();
    expect(stagesProps.ttfb).toBeDefined();
    expect(stagesProps.body).toBeDefined();
  });

  it("schema stageStats has medianMs, minMs, maxMs", async () => {
    const schema = await loadOutputSchema();
    const stageStats = (schema as any).$defs.stageStats.properties;

    expect(stageStats.medianMs).toBeDefined();
    expect(stageStats.minMs).toBeDefined();
    expect(stageStats.maxMs).toBeDefined();
  });

  it("schema family enum is IPv4 | IPv6", async () => {
    const schema = await loadOutputSchema();
    const familyProp = (schema as any).properties.family;

    expect(familyProp.enum).toEqual(["IPv4", "IPv6"]);
  });

  it("serialized output matches schema structure", async () => {
    const results = createAggregatedResults();
    const json = serializeResults(results);
    const parsed = JSON.parse(json);

    // Verify all required fields from schema are present
    expect(parsed).toHaveProperty("stages");
    expect(parsed).toHaveProperty("total");
    expect(parsed).toHaveProperty("runsRequested");
    expect(parsed).toHaveProperty("runsSuccessful");
    expect(parsed).toHaveProperty("runsFailed");
    expect(parsed).toHaveProperty("url");
    expect(parsed).toHaveProperty("ip");
    expect(parsed).toHaveProperty("family");
    expect(parsed).toHaveProperty("statusCode");
    expect(parsed).toHaveProperty("warnings");

    // Verify stages structure
    expect(parsed.stages).toHaveProperty("dns");
    expect(parsed.stages).toHaveProperty("tcp");
    expect(parsed.stages).toHaveProperty("tls");
    expect(parsed.stages).toHaveProperty("ttfb");
    expect(parsed.stages).toHaveProperty("body");

    // Verify each stage has median/min/max
    for (const stage of ["dns", "tcp", "tls", "ttfb", "body"] as const) {
      expect(parsed.stages[stage]).toHaveProperty("medianMs");
      expect(parsed.stages[stage]).toHaveProperty("minMs");
      expect(parsed.stages[stage]).toHaveProperty("maxMs");
    }

    // Verify total has median/min/max
    expect(parsed.total).toHaveProperty("medianMs");
    expect(parsed.total).toHaveProperty("minMs");
    expect(parsed.total).toHaveProperty("maxMs");
  });
});

describe("json - round-trip serialization", () => {
  it("serialize -> parse -> serialize produces equivalent output", () => {
    const original = createAggregatedResults({
      runsRequested: 10,
      runsSuccessful: 8,
      runsFailed: 2,
      warnings: ["Warning: 2 of 10 runs failed."],
    });

    const json1 = serializeResults(original);
    const parsed = parseResults(json1);
    const json2 = serializeResults(parsed);

    // Both should parse to equivalent objects
    const obj1 = JSON.parse(json1);
    const obj2 = JSON.parse(json2);
    expect(obj1).toEqual(obj2);
  });

  it("handles all field variations", () => {
    const variations = [
      { family: "IPv4" as const },
      { family: "IPv6" as const, ip: "::1" },
      { runsRequested: 1, runsSuccessful: 1, runsFailed: 0 },
      { runsRequested: 100, runsSuccessful: 95, runsFailed: 5 },
      { warnings: ["Warning 1", "Warning 2", "Warning 3"] },
      { url: "http://localhost:3000/path?query=value" },
    ];

    for (const variation of variations) {
      const results = createAggregatedResults(variation);
      const json = serializeResults(results);
      const parsed = parseResults(json);
      expect(parsed).toEqual(results);
    }
  });
});