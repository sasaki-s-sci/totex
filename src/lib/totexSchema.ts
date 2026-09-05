import type { RJSFSchema } from "@rjsf/utils";

/** The editable document in ~/.totex/totex.json; unknown fields are retained. */
export const totexSchema: RJSFSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "totex.json",
  type: "object",
  properties: {
    theme: { title: "Theme", type: "string", enum: ["system", "light", "dark"] },
    language: { title: "Language", type: "string", enum: ["system", "en", "ja"] },
    reveal: { title: "Reveal", type: "string", enum: ["never", "edge", "centre"] },
    follow: { title: "Follow", type: "boolean" },
    mcpServing: { title: "MCP server", type: "boolean" },
    fileTitle: { title: "File title", type: "string", enum: ["name", "path"] },
    readingSize: { title: "Reading size", type: "integer", minimum: 8, maximum: 20 },
    said: {
      title: "Agent output",
      type: "object",
      properties: {
        showing: { type: "boolean" },
        face: { type: "string", enum: ["terminal", "window"] },
        size: { type: "integer", minimum: 1, maximum: 20 },
        lines: { type: "integer", minimum: 1, maximum: 6 },
        width: { type: "integer", minimum: 80, maximum: 640 },
        fitting: { type: "boolean" },
      },
    },
  },
};
