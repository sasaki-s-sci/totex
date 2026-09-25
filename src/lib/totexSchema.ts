import type { RJSFSchema } from "@rjsf/utils";

/** ~/.totex/totex.json; unknown fields are retained on write. */
export const totexSchema: RJSFSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "totex.json",
  type: "object",
  properties: {
    theme: { title: "Theme", type: "string", enum: ["system", "light", "dark"] },
    // Ids, not an enum: they name files under ~/.totex/themes as well as the built-ins.
    appearance: {
      title: "Appearance",
      type: "object",
      properties: {
        colors: { title: "Colors", type: "string", minLength: 1 },
        style: { title: "Style", type: "string", minLength: 1 },
        effects: { title: "Effects", type: "string", minLength: 1 },
      },
    },
    language: { title: "Language", type: "string", enum: ["system", "en", "ja"] },
    reveal: { title: "Reveal", type: "string", enum: ["never", "edge", "centre"] },
    walkWrap: { title: "Ctrl+Arrow comes round at the ends", type: "boolean" },
    terminalSort: {
      title: "Terminal sort",
      type: "string",
      enum: ["createdWhere", "createdAt"],
    },
    follow: { title: "Follow", type: "boolean" },
    spareWorktree: { title: "Keep a spare worktree", type: "boolean" },
    backgroundGrid: { title: "Background grid", type: "boolean" },
    gridStep: { title: "Grid spacing (px)", type: "integer", minimum: 1, maximum: 100 },
    gridSnap: { title: "Hold file cards to the grid", type: "boolean" },
    groupGap: {
      title: "Grid rows between repositories and folders",
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
    mcpServing: { title: "MCP server", type: "boolean" },
    fileTitle: { title: "File title", type: "string", enum: ["name", "path"] },
    readingSize: { title: "Reading size", type: "integer", minimum: 8, maximum: 20 },
    cliWheel: { title: "Terminal wheel (%)", type: "integer", minimum: 25, maximum: 400 },
    graphWheel: { title: "Canvas wheel (%)", type: "integer", minimum: 25, maximum: 400 },
    said: {
      title: "Agent output",
      type: "object",
      properties: {
        showing: { type: "boolean" },
        opacity: { type: "integer", minimum: 1, maximum: 100 },
        face: { type: "string", enum: ["terminal", "window"] },
        size: { type: "integer", minimum: 1, maximum: 20 },
        lines: { type: "integer", minimum: 1, maximum: 6 },
        width: { type: "integer", minimum: 80, maximum: 640 },
        fitting: { type: "boolean" },
      },
    },
  },
};
