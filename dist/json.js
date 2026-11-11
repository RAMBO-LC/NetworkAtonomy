/**
 * JSON serialization for Network Atonomy results.
 *
 * Provides functions to serialize AggregatedResults to JSON string
 * and validate against the output schema.
 */
/**
 * Serialize AggregatedResults to a JSON string with consistent formatting.
 *
 * @param results - The aggregated results to serialize
 * @param options - Serialization options
 * @returns JSON string representation of the results
 */
export function serializeResults(results, options = {}) {
    const { pretty = true } = options;
    const space = pretty ? 2 : 0;
    return JSON.stringify(results, null, space);
}
/**
 * Parse and validate a JSON string as AggregatedResults.
 *
 * @param json - JSON string to parse
 * @returns Parsed AggregatedResults object
 * @throws {Error} If JSON is invalid or doesn't match schema
 */
export function parseResults(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch (error) {
        throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isAggregatedResults(parsed)) {
        throw new Error("JSON does not match AggregatedResults schema");
    }
    return parsed;
}
/**
 * Type guard to validate an object matches AggregatedResults structure.
 *
 * @param value - Unknown value to validate
 * @returns True if value matches AggregatedResults
 */
export function isAggregatedResults(value) {
    if (!value || typeof value !== "object")
        return false;
    const obj = value;
    // Check required top-level fields
    if (typeof obj.runsRequested !== "number" ||
        typeof obj.runsSuccessful !== "number" ||
        typeof obj.runsFailed !== "number" ||
        typeof obj.url !== "string" ||
        typeof obj.ip !== "string" ||
        typeof obj.family !== "string" ||
        typeof obj.statusCode !== "number" ||
        !Array.isArray(obj.warnings) ||
        !obj.stages ||
        typeof obj.stages !== "object" ||
        !obj.total ||
        typeof obj.total !== "object") {
        return false;
    }
    // Validate family enum
    if (obj.family !== "IPv4" && obj.family !== "IPv6") {
        return false;
    }
    // Validate warnings array
    if (!obj.warnings.every((w) => typeof w === "string")) {
        return false;
    }
    // Validate stages
    const stages = obj.stages;
    const requiredStages = ["dns", "tcp", "tls", "ttfb", "body"];
    for (const stage of requiredStages) {
        if (!isStageStats(stages[stage])) {
            return false;
        }
    }
    // Validate total
    if (!isStageStats(obj.total)) {
        return false;
    }
    return true;
}
/**
 * Type guard for StageStats.
 */
function isStageStats(value) {
    if (!value || typeof value !== "object")
        return false;
    const obj = value;
    return (typeof obj.medianMs === "number" &&
        typeof obj.minMs === "number" &&
        typeof obj.maxMs === "number" &&
        obj.medianMs >= 0 &&
        obj.minMs >= 0 &&
        obj.maxMs >= 0);
}
/**
 * Read and parse the JSON output schema.
 *
 * @returns The parsed JSON schema object
 */
export async function loadOutputSchema() {
    // In Node.js, we can read the schema file directly
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const schemaPath = path.resolve(import.meta.dirname, "..", "schema", "output.json");
    const content = await fs.readFile(schemaPath, "utf-8");
    return JSON.parse(content);
}
