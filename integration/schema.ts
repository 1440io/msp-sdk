import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Named imports: ajv and ajv-formats are CJS, and the named class dodges the
// default-interop dance entirely.
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule, { type FormatsPlugin } from 'ajv-formats';

// ajv-formats is CJS: depending on the loader, the plugin arrives either as the
// module itself or nested under `.default`. Accept both.
const addFormats: FormatsPlugin =
  (addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
  (addFormatsModule as unknown as FormatsPlugin);
import { env } from './env.ts';

const SPEC_PATH = resolve(import.meta.dirname, '../spec/1440-cloud-openapi.json');

interface OpenApiDocument {
  components: { schemas: Record<string, unknown> };
}

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;

/** Every schema name the spec declares. */
export type SchemaName = string;

// OpenAPI 3.1 schemas are JSON Schema 2020-12, so they validate as-is. Strict
// mode is off because the document carries OpenAPI keywords (`example`,
// `discriminator`) that Ajv does not know.
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: true,
});
addFormats(ajv);
ajv.addSchema(spec, 'msp-spec');

const cache = new Map<string, ValidateFunction>();

function validatorFor(name: SchemaName): ValidateFunction {
  const cached = cache.get(name);
  if (cached) return cached;

  if (!(name in spec.components.schemas)) {
    throw new Error(`No schema named "${name}" in the OpenAPI document`);
  }
  const validate = ajv.getSchema(`msp-spec#/components/schemas/${name}`);
  if (!validate) throw new Error(`Ajv could not compile schema "${name}"`);
  cache.set(name, validate);
  return validate;
}

/**
 * Deviations we have confirmed against production and decided to track rather
 * than fail on. Each one is a spec bug or a server bug that someone needs to
 * reconcile — listing it here keeps the suite honest about the difference
 * without turning every run red.
 */
const KNOWN_DRIFT: { schema: string; path: string; match: RegExp; note: string }[] = [
  // Empty as of the 0.2.0 spec. The previous entry — time-picker
  // selectedStartTime declared `format: date-time` while sending Apple's basic
  // format — is resolved: the schema now pins the real shape with a pattern.
];

/** What a live response looked like against the spec. */
export interface SchemaCheckResult {
  /** Violations that mean the response contradicts the spec. */
  violations: string[];
  /** Undocumented properties — the server running ahead of the spec, usually. */
  undocumented: string[];
}

/** Validate a value against a named schema without throwing. */
export function checkSchema(name: SchemaName, value: unknown): SchemaCheckResult {
  const validate = validatorFor(name);
  validate(value);
  const errors: ErrorObject[] = validate.errors ?? [];

  const violations: string[] = [];
  const undocumented: string[] = [];

  for (const error of errors) {
    const path = error.instancePath === '' ? '(root)' : error.instancePath;
    const message = error.message ?? 'failed validation';

    if (error.keyword === 'additionalProperties') {
      const property = (error.params as { additionalProperty?: string }).additionalProperty;
      undocumented.push(`${path} has undocumented property "${property}"`);
      continue;
    }

    const known = KNOWN_DRIFT.find(
      (entry) => entry.schema === name && entry.path === path && entry.match.test(message),
    );
    if (known) {
      undocumented.push(`${path} ${message} — known drift: ${known.note}`);
      continue;
    }

    violations.push(`${path} ${message}`);
  }

  return { violations, undocumented };
}

/** Warnings collected across the run, printed once at the end. */
const collectedWarnings: string[] = [];

/**
 * Assert a live response matches its spec schema.
 *
 * A missing required field, a wrong type, or an unknown enum value fails the
 * test — that is real drift between production and the document the SDK is
 * generated from. An undocumented extra property is only a warning by default,
 * since additive server changes are routine; set `MSP_TEST_STRICT_SCHEMA=1` to
 * fail on those too.
 */
export function assertMatchesSchema(name: SchemaName, value: unknown, context = ''): void {
  const { violations, undocumented } = checkSchema(name, value);
  const label = context ? `${name} (${context})` : name;

  if (undocumented.length > 0) {
    const message = `${label}: ${undocumented.join('; ')}`;
    if (env.strictSchema) violations.push(...undocumented);
    else if (!collectedWarnings.includes(message)) collectedWarnings.push(message);
  }

  if (violations.length > 0) {
    throw new Error(
      `Live response does not match the OpenAPI schema ${label}:\n` +
        violations.map((v) => `  - ${v}`).join('\n') +
        `\n\nReceived:\n${JSON.stringify(value, null, 2).slice(0, 2000)}`,
    );
  }
}

/** Validate every item in an array against a schema. */
export function assertEachMatchesSchema(
  name: SchemaName,
  values: readonly unknown[],
  context = '',
): void {
  values.forEach((value, index) => {
    assertMatchesSchema(name, value, context ? `${context}[${index}]` : `[${index}]`);
  });
}

/** Schema warnings gathered so far. */
export function schemaWarnings(): readonly string[] {
  return collectedWarnings;
}

/** Print the warning summary, if the run produced any. */
export function reportSchemaWarnings(): void {
  if (collectedWarnings.length === 0) return;
  console.warn(
    `\n⚠  ${collectedWarnings.length} undocumented field(s) in live responses ` +
      `(the API is ahead of spec/1440-cloud-openapi.json):`,
  );
  for (const warning of collectedWarnings) console.warn(`   - ${warning}`);
  console.warn('   Refresh the spec and run `npm run generate` to pick them up.\n');
}
