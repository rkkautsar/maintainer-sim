import type { Run, Finding, ReviewCoaching } from "./types.ts";
export interface Persistence {
  db: {
    prepare(sql: string): {
      run(...args: any[]): any;
      get(...args: any[]): any;
      all(...args: any[]): any[];
    };
  };
  save(run: Run): void;
  get(id: string): Run;
  all(): Run[];
}
export interface Reviewer {
  coach?(
    review: string,
    files: Record<string, string>,
  ): Promise<ReviewCoaching | undefined>;
  evaluate(
    review: string,
    concern: string,
    files: Record<string, string>,
  ): Promise<Finding["category"] | undefined>;
}
