import type { FleetPayload, FleetRange } from "./api";

/** Dev-only UI fixtures written by backend/scripts/make_fleet_fixtures.py from the real aggregation code. */
const files = import.meta.glob("./fixtures/*.json");

export async function loadFixture(name: string, range: FleetRange): Promise<FleetPayload> {
  const key = `./fixtures/${name === "real" ? "real" : `fleet${name}`}.${range}.json`;
  const load = files[key];
  if (!load) throw new Error(`Unknown fixture ${name}`);
  const mod = (await load()) as { default: FleetPayload };
  return mod.default;
}
