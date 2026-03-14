import { z } from "zod";

export type ToolCategory = "always" | "coding";

export interface ToolRegistration {
  name: string;
  description: string;
  category?: ToolCategory;
  zodSchema: Record<string, z.ZodTypeAny>;
  jsonSchemaParameters: {
    type: "object";
    required: string[];
    properties: Record<string, any>;
  };
  execute: (args: any) => Promise<string>;
  /** Per-tool frequency limit for loop guard. Defaults to 20 if not set. */
  frequencyLimit?: number;
}
