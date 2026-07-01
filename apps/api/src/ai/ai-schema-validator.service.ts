import { Injectable } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Parses model output as JSON and validates it against a zod schema. Tolerates
 * ```json fences and leading/trailing prose so a structured task can recover the
 * object even when the model wraps it. On any failure returns `ok:false` so the
 * router marks the report FAILED and tries the fallback model instead of
 * persisting garbage.
 */
@Injectable()
export class AiSchemaValidator {
  validate<T>(schema: ZodType<T, ZodTypeDef, unknown>, content: string): ValidationResult<T> {
    const json = this.extractJson(content);
    if (json === null) {
      return { ok: false, error: 'No JSON object found in model output' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { ok: false, error: `Schema mismatch: ${issues}` };
    }
    return { ok: true, data: result.data };
  }

  /** Strips ```json fences and isolates the outermost {...} object. */
  private extractJson(content: string): string | null {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : content).trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      return null;
    }
    return body.slice(start, end + 1);
  }
}
