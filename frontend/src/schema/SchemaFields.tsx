import { type ReactNode, useId } from "react";
import { get, useController, useFormContext, useWatch } from "react-hook-form";
import type { JsonSchema } from "./jsonSchema";
import { evaluateShowIf } from "./showIf";
import styles from "./SchemaFields.module.css";

type Props = {
  /** An object schema; one input is rendered per property, in key order. */
  schema: JsonSchema;
  /** Form path of the object, e.g. `entities.0`; empty for the form root. */
  prefix: string;
  layout?: "stack" | "row";
  /** Unit inherited from a parent (e.g. a `range` whose `x-unit` applies to min and max). */
  unit?: string;
};

/** Renders a schema-described object inside a react-hook-form `FormProvider`. */
export function SchemaFields({ schema, prefix, layout = "stack", unit }: Props) {
  const { control } = useFormContext();
  const all: unknown = useWatch({ control });
  const scoped: unknown = prefix ? get(all, prefix) : all;
  const values = typeof scoped === "object" && scoped !== null ? scoped : {};

  return (
    <div className={layout === "row" ? styles.row : styles.stack}>
      {Object.entries(schema.properties ?? {}).map(([key, field]) =>
        evaluateShowIf(field["x-show-if"], values as Record<string, unknown>) ? (
          <SchemaField
            key={key}
            name={prefix ? `${prefix}.${key}` : key}
            label={field.title ?? humanize(key)}
            schema={field}
            unit={field["x-unit"] ?? unit}
          />
        ) : null,
      )}
    </div>
  );
}

type FieldProps = { name: string; label: string; schema: JsonSchema; unit: string | undefined };

function SchemaField(props: FieldProps) {
  const { schema, name, label } = props;
  const ui = schema["x-ui-component"];
  if (ui === "coordinate" || ui === "range") {
    return (
      <fieldset className={styles.group}>
        <legend className={styles.label}>{label}</legend>
        <SchemaFields schema={schema} prefix={name} layout="row" unit={props.unit} />
      </fieldset>
    );
  }
  // numeric-or-file: inline numeric mode only for now; the file toggle lands with #30.
  if (ui === "numeric-or-file") return <NumberField {...props} />;
  switch (schema.type) {
    case "object":
      return (
        <fieldset className={styles.group}>
          <legend className={styles.label}>{label}</legend>
          <SchemaFields schema={schema} prefix={name} unit={props.unit} />
        </fieldset>
      );
    case "boolean":
      return <BooleanField {...props} />;
    case "number":
    case "integer":
      return <NumberField {...props} />;
    case "string":
      return schema.enum ? <EnumField {...props} /> : <TextField {...props} />;
    default:
      return null; // arrays are laid out by the caller (e.g. the entity list)
  }
}

function Field(props: {
  id: string;
  label: string;
  unit?: string | undefined;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={styles.field} data-field data-invalid={props.error ? "" : undefined}>
      <label htmlFor={props.id} className={styles.label}>
        {props.label}
      </label>
      <div className={styles.inputWrap}>
        {props.children}
        {props.unit && <span className={styles.unit}>{props.unit}</span>}
      </div>
      {props.error && <span className={styles.error}>{props.error}</span>}
    </div>
  );
}

function NumberField({ name, label, unit }: FieldProps) {
  const id = useId();
  const { field, fieldState } = useController({ name });
  const { ref: inputRef } = field;
  const value: unknown = field.value;
  return (
    <Field id={id} label={label} unit={unit} error={fieldState.error?.message}>
      <input
        id={id}
        ref={inputRef}
        type="number"
        step="any"
        className={unit ? `${styles.input} ${styles.hasUnit}` : styles.input}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          field.onChange(Number.isNaN(n) ? undefined : n);
        }}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

function TextField({ name, label, unit }: FieldProps) {
  const id = useId();
  const { field, fieldState } = useController({ name });
  const { ref: inputRef } = field;
  const value: unknown = field.value;
  return (
    <Field id={id} label={label} unit={unit} error={fieldState.error?.message}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        className={styles.input}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
      />
    </Field>
  );
}

function EnumField({ name, label, schema }: FieldProps) {
  const id = useId();
  const { field, fieldState } = useController({ name });
  const { ref: inputRef } = field;
  const options = schema.enum ?? [];
  const selected = options.find((option) => option === field.value);
  return (
    <Field id={id} label={label} error={fieldState.error?.message}>
      <select
        id={id}
        ref={inputRef}
        className={styles.input}
        value={selected === undefined ? "" : String(selected)}
        onChange={(e) => field.onChange(options.find((o) => String(o) === e.target.value))}
        onBlur={field.onBlur}
      >
        {selected === undefined && <option value="">—</option>}
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function BooleanField({ name, label }: FieldProps) {
  const id = useId();
  const { field } = useController({ name });
  const { ref: inputRef } = field;
  return (
    <div className={styles.toggle} data-field>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="checkbox"
        className={styles.switch}
        checked={field.value === true}
        onChange={(e) => field.onChange(e.target.checked)}
        onBlur={field.onBlur}
      />
    </div>
  );
}

function humanize(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
