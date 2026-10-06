import { useMemo } from "react";
import { type FieldValues, FormProvider, get, useForm, useWatch } from "react-hook-form";
import type { Schemas } from "../api";
import type { LngLat } from "../geo";
import { MapView, type MapEntity } from "../MapView";
import { createScenarioResolver, defaultValues } from "../schema/formModel";
import type { JsonSchema } from "../schema/jsonSchema";
import { SchemaFields } from "../schema/SchemaFields";
import styles from "./ScenarioWorkspace.module.css";

// The entity list and the map are the hardcoded shell around the schema-driven fields.
const ENTITIES = "entities";
const FIRST_ENTITY = `${ENTITIES}.0`;

type Props = {
  schemas: Schemas | null;
  onSubmit: (scenario: FieldValues) => void;
};

/** Scenario sidebar plus map; the map marker and the entity's coordinate fields stay in sync. */
export function ScenarioWorkspace({ schemas, onSubmit }: Props) {
  if (!schemas) {
    return (
      <Layout
        sidebar={<h2 className={styles.title}>Scenario</h2>}
        map={<MapView entity={null} onEntityMove={() => {}} />}
      />
    );
  }
  return <LoadedWorkspace schemas={schemas} onSubmit={onSubmit} />;
}

function LoadedWorkspace({ schemas, onSubmit }: Props & { schemas: Schemas }) {
  const resolver = useMemo(() => createScenarioResolver(schemas), [schemas]);
  const initial = useMemo(
    () => ({ ...defaultValues(schemas.scenario), [ENTITIES]: [defaultValues(schemas.entity)] }),
    [schemas],
  );
  const form = useForm({
    mode: "onBlur",
    shouldUnregister: true, // hidden (x-show-if) fields drop out of the submitted scenario
    resolver,
    defaultValues: initial,
  });

  const coordinateKey = findCoordinateKey(schemas.entity);
  const firstEntity: unknown = useWatch({ control: form.control, name: FIRST_ENTITY });
  const mapEntity = coordinateKey ? toMapEntity(firstEntity, coordinateKey) : null;

  function moveEntity({ lng, lat }: LngLat) {
    if (!coordinateKey) return;
    form.setValue(
      `${FIRST_ENTITY}.${coordinateKey}`,
      { lat: round6(lat), lon: round6(lng) },
      { shouldValidate: true, shouldDirty: true },
    );
  }

  const listError: unknown = get(form.formState.errors, `${ENTITIES}.root.message`);

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
            <div className={styles.label}>Entities</div>
            <section className={styles.entityCard} aria-label="Entity 1">
              <div className={styles.entityHead}>Entity 1</div>
              <div className={styles.entityBody}>
                <SchemaFields schema={schemas.entity} prefix={FIRST_ENTITY} />
              </div>
            </section>
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
      map={<MapView entity={mapEntity} onEntityMove={moveEntity} />}
    />
  );
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
