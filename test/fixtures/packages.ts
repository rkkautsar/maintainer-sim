import forum010 from "./forum-0.1.0.json" with { type: "json" };
import forum011 from "./forum-0.1.1.json" with { type: "json" };
import { packageScope, type ScenarioPackage } from "../../src/packages.ts";

/** Compact synthetic release content for core/game/storage tests. */
export const packages = [
  forum010 as ScenarioPackage,
  forum011 as ScenarioPackage,
] as const;

// These test modules run in their own node:test worker context. Keep the fixture
// catalogue available to synchronous package helpers in each test file.
packageScope.enterWith(packages);
