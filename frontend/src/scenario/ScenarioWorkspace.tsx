import { useMemo, useState } from "react";
import {
  type FieldValues,
  FormProvider,
  get,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import type { Schemas } from "../api";
import type { LngLat } from "../geo";
import type { Slice } from "../run/slice";
import { MapView, type MapEntity } from "../MapView";
import { createScenarioResolver, defaultValues } from "../schema/formModel";
import type { JsonSchema } from "../schema/jsonSchema";
import { SchemaFields } from "../schema/SchemaFields";
import styles from "./ScenarioWorkspace.module.css";

// The entity list and the map are the hardcoded shell around the schema-driven fields.
const ENTITIES = "entities";

type Props = {
  schemas: Schemas | null;
  onSubmit: (scenario: FieldValues) => void;
  /** The current run's slice, drawn on the map. */
  heatmap: Slice | null;
};

/** Scenario sidebar plus map; each entity's marker and coordinate fields stay in sync. */
export function ScenarioWorkspace({ schemas, onSubmit, heatmap }: Props) {
  if (!schemas) {
    return (
      <Layout
        sidebar={<h2 className={styles.title}>Scenario</h2>}
        map={<MapView entities={[]} activeIndex={0} onEntityMove={() => {}} heatmap={null} />}
      />
    );
  }
  return <LoadedWorkspace schemas={schemas} onSubmit={onSubmit} heatmap={heatmap} />;
}

function LoadedWorkspace({ schemas, onSubmit, heatmap }: Props & { schemas: Schemas }) {
  const listSchema = schemas.scenario.properties?.[ENTITIES];
  const minEntities = Math.max(listSchema?.minItems ?? 1, 1);
  const maxEntities = listSchema?.maxItems ?? Infinity;

  const resolver = useMemo(() => createScenarioResolver(schemas), [schemas]);
  const initial = useMemo(
    () => ({
      ...defaultValues(schemas.scenario),
      [ENTITIES]: Array.from({ length: minEntities }, () => defaultValues(schemas.entity)),
    }),
    [schemas, minEntities],
  );
  const form = useForm({
    mode: "onBlur",
    shouldUnregister: true, // hidden (x-show-if) fields drop out of the submitted scenario
    resolver,
    defaultValues: initial,
  });
  const list = useFieldArray({ control: form.control, name: ENTITIES });
  const [activeIndex, setActiveIndex] = useState(0);

  const coordinateKey = findCoordinateKey(schemas.entity);
  const entities: unknown = useWatch({ control: form.control, name: ENTITIES });
  const mapEntities = (Array.isArray(entities) ? entities : []).map((entity: unknown) =>
    coordinateKey ? toMapEntity(entity, coordinateKey) : null,
  );

  function moveEntity(index: number, { lng, lat }: LngLat) {
    setActiveIndex(index);
    if (!coordinateKey) return;
    form.setValue(
      `${ENTITIES}.${index}.${coordinateKey}`,
      { lat: round6(lat), lon: round6(lng) },
      { shouldValidate: true, shouldDirty: true },
    );
  }

  function addEntity() {
    list.append(defaultValues(schemas.entity));
    setActiveIndex(list.fields.length); // the new entity is placed by the next map click
  }

  function removeEntity(index: number) {
    list.remove(index);
    setActiveIndex((active) =>
      active > index ? active - 1 : Math.min(active, list.fields.length - 2),
    );
  }

  const listError: unknown = get(form.formState.errors, `${ENTITIES}.root.message`);
  const canRemove = list.fields.length > minEntities;

  return (
    <Layout
      sidebar={
        <FormProvider {...form}>
          <form
            className={styles.form}
            noValidate
            onSubmit={form.handleSubmit((values) => onSubmit(values))}
          >
            <h2 className={styles.title}>Scenario</h2>
            <SchemaFields schema={schemas.scenario} prefix="" />
            <div className={styles.listHead}>
              <div className={styles.label}>
                Entities {list.fields.length}/{maxEntities}
              </div>
              <button
                type="button"
                className={styles.ghost}
                disabled={list.fields.length >= maxEntities}
                onClick={addEntity}
              >
                Add entity
              </button>
            </div>
            {list.fields.map((item, index) => (
              <section
                key={item.id}
                className={styles.entityCard}
                aria-label={`Entity ${index + 1}`}
                data-active={index === activeIndex ? "" : undefined}
              >
                <div className={styles.entityHead}>
                  <button
                    type="button"
                    className={styles.entityName}
                    aria-pressed={index === activeIndex}
                    title="Map clicks place the selected entity"
                    onClick={() => setActiveIndex(index)}
                  >
                    Entity {index + 1}
                    <EntityLabel index={index} />
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    aria-label={`Remove entity ${index + 1}`}
                    disabled={!canRemove}
                    onClick={() => removeEntity(index)}
                  >
                    Remove
                  </button>
                </div>
                <div className={styles.entityBody}>
                  <SchemaFields schema={schemas.entity} prefix={`${ENTITIES}.${index}`} />
                </div>
              </section>
            ))}
            {typeof listError === "string" && (
              <p role="alert" className={styles.formError}>
                {listError}
              </p>
            )}
            <button type="submit" className={styles.submit}>
              Run simulation
            </button>
          </form>
        </FormProvider>
      }
      map={
        <MapView
          entities={mapEntities}
          activeIndex={activeIndex}
          onEntityMove={moveEntity}
          heatmap={heatmap}
        />
      }
    />
  );
}

/** The entity's `label` value, if it has one, as a display name in the card header. */
function EntityLabel({ index }: { index: number }) {
  const label: unknown = useWatch({ name: `${ENTITIES}.${index}.label` });
  return typeof label === "string" && label ? (
    <span className={styles.entityLabel}> · {label}</span>
  ) : null;
}

function Layout({ sidebar, map }: { sidebar: React.ReactNode; map: React.ReactNode }) {
  return (
    <div className={styles.body}>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.map}>{map}</main>
    </div>
  );
}

function findCoordinateKey(entity: JsonSchema): string | undefined {
  return Object.entries(entity.properties ?? {}).find(
    ([, field]) => field["x-ui-component"] === "coordinate",
  )?.[0];
}

/** The entity as the map draws it, or null while its position isn't a valid coordinate yet. */
function toMapEntity(entity: unknown, coordinateKey: string): MapEntity | null {
  const lat: unknown = get(entity, `${coordinateKey}.lat`);
  const lon: unknown = get(entity, `${coordinateKey}.lon`);
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const radius: unknown = get(entity, "radius");
  return { lat, lng: lon, radiusKm: typeof radius === "number" && radius > 0 ? radius : 0 };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
