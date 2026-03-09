import * as fs from "fs";
import * as path from "path";

export class JsonStore<T> {
  private cache: T | null = null;

  constructor(
    private readonly filePath: string,
    private readonly emptyValue: T,
  ) {}

  read(): T {
    if (this.cache !== null) return this.cache;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      this.cache = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as T;
    } catch {
      this.cache = this.cloneEmptyValue();
    }

    return this.cache;
  }

  write(value: T): void {
    this.cache = value;

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(value, null, 2), "utf-8");
    } catch (err: any) {
      console.error("[json-store] Failed to write %s: %s", this.filePath, err.message);
    }
  }

  update(mutator: (current: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }

  reset(): T {
    const next = this.cloneEmptyValue();
    this.write(next);
    return next;
  }

  private cloneEmptyValue(): T {
    return JSON.parse(JSON.stringify(this.emptyValue)) as T;
  }
}
